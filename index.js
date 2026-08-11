
import * as THREE from "three";
import * as adk from "https://esm.sh/admdongkor";

/* ------------------------------------------------------------------ *
 * 1. 지역 순서 ↔ 시도코드 매핑
 *
 * data.json의 각 배열은 다음 순서로 17개 값을 가진다:
 *
 * [전국, 서울, 부산, 대구, 인천, 대전, 울산, 경기, 강원, 충북,
 *  충남, 전북, 경북, 경남, 제주, 세종, 전남광주]
 *
 * 지도 GeoJSON에서 확인한 실제 CD 코드 기준:
 *
 * 강원       = 51
 * 전북       = 52
 * 전남·광주 = 12
 *
 * 전남·광주는 정부 데이터와 data.json 모두 하나의 통합 지역이므로
 * 별도의 병합/분배 로직을 사용하지 않는다.
 * ------------------------------------------------------------------ */

const REGION_META = [
  { name: "서울", code: "11" },
  { name: "부산", code: "26" },
  { name: "대구", code: "27" },
  { name: "인천", code: "28" },
  { name: "대전", code: "30" },
  { name: "울산", code: "31" },
  { name: "경기", code: "41" },

  // 실제 GeoJSON CD 코드
  { name: "강원", code: "51" },

  { name: "충북", code: "43" },
  { name: "충남", code: "44" },

  // 실제 GeoJSON CD 코드
  { name: "전북", code: "52" },

  { name: "경북", code: "47" },
  { name: "경남", code: "48" },
  { name: "제주", code: "50" },
  { name: "세종", code: "36" },

  // 정부 데이터 / data.json / 지도 모두 통합
  { name: "전남·광주", code: "12" },
];


/* ------------------------------------------------------------------ *
 * 설정
 * ------------------------------------------------------------------ */

const MAP_VERSION = "20260701";

const HEIGHT_MIN = 5;
const HEIGHT_MAX = 100;
const HEIGHT_DEFAULT = 60;

const MIN_HEIGHT_FLOOR = 1.2;

const COLOR_LOW = 0x2c6e63;
const COLOR_MID = 0xf2c14e;
const COLOR_HIGH = 0xff6b4a;

const HIGHLIGHT_COLOR = 0xffd98a;

const ELEVATION_DEG = 85;
const AZIMUTH_MIN = -20;
const AZIMUTH_MAX = 20;

const CAMERA_DISTANCE = 420;
const VIEW_HALF_HEIGHT = 128;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.2;


/* ------------------------------------------------------------------ *
 * 상태
 * ------------------------------------------------------------------ */

let maxExtrudeHeight = HEIGHT_DEFAULT;
let tiltAzimuth = 0;


/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const els = {
  host: document.getElementById("canvas-host"),
  labelsLayer: document.getElementById("labels-layer"),

  loading: document.getElementById("loading"),

  errorPanel: document.getElementById("error-panel"),
  errorBody: document.querySelector(
    "#error-panel .error-panel__body"
  ),

  yearSelect: document.getElementById("year-select"),
  diseaseSelect: document.getElementById("disease-select"),

  total: document.getElementById("total-value"),
  legendMax: document.getElementById("legend-max"),

  tiltSlider: document.getElementById("tilt-slider"),

  heightSlider: document.getElementById("height-slider"),
  heightValue: document.getElementById("height-value"),

  tooltip: document.getElementById("tooltip"),
  tooltipName: document.querySelector(".tooltip__name"),
  tooltipValue: document.querySelector(".tooltip__value"),
  tooltipNote: document.querySelector(".tooltip__note"),
};


/* ------------------------------------------------------------------ *
 * Loading / Error
 * ------------------------------------------------------------------ */

function setLoading(isLoading, message) {
  if (message) {
    els.loading.querySelector("p").textContent = message;
  }

  els.loading.classList.toggle(
    "hidden",
    !isLoading
  );
}


function showError(message) {
  els.errorBody.textContent = message;
  els.errorPanel.classList.remove("hidden");

  setLoading(false);
}


function hideError() {
  els.errorPanel.classList.add("hidden");
}


/* ------------------------------------------------------------------ *
 * 2. Three.js Scene
 * ------------------------------------------------------------------ */

const scene = new THREE.Scene();

scene.background =
  new THREE.Color(0x0a0f0d);

scene.fog =
  new THREE.Fog(
    0x0a0f0d,
    300,
    700
  );


const initialWidth =
  Math.max(1, els.host.clientWidth);

const initialHeight =
  Math.max(1, els.host.clientHeight);

const aspect0 =
  initialWidth / initialHeight;


const camera =
  new THREE.OrthographicCamera(
    -VIEW_HALF_HEIGHT * aspect0,
    VIEW_HALF_HEIGHT * aspect0,
    VIEW_HALF_HEIGHT,
    -VIEW_HALF_HEIGHT,
    0.1,
    2000
  );


const target =
  new THREE.Vector3(
    0,
    8,
    0
  );


const renderer =
  new THREE.WebGLRenderer({
    antialias: true,
  });


renderer.setPixelRatio(
  Math.min(
    window.devicePixelRatio,
    2
  )
);


renderer.setSize(
  initialWidth,
  initialHeight
);


renderer.domElement.style.touchAction =
  "none";


els.host.appendChild(
  renderer.domElement
);


/* ------------------------------------------------------------------ *
 * 조명
 * ------------------------------------------------------------------ */

scene.add(
  new THREE.AmbientLight(
    0x8fa79b,
    0.6
  )
);


const sun =
  new THREE.DirectionalLight(
    0xfff2df,
    1.05
  );

sun.position.set(
  140,
  260,
  120
);

scene.add(sun);


const rim =
  new THREE.DirectionalLight(
    0x2c6e63,
    0.35
  );

rim.position.set(
  -160,
  80,
  -140
);

scene.add(rim);


/* ------------------------------------------------------------------ *
 * 바닥
 * ------------------------------------------------------------------ */

const grid =
  new THREE.GridHelper(
    340,
    34,
    0x223029,
    0x152019
  );

grid.position.y = -0.6;

scene.add(grid);


const plate =
  new THREE.Mesh(
    new THREE.CylinderGeometry(
      160,
      160,
      1.2,
      64
    ),
    new THREE.MeshStandardMaterial({
      color: 0x0d1512,
      roughness: 1,
    })
  );

plate.position.y = -1.2;

scene.add(plate);


/* ------------------------------------------------------------------ *
 * 지도 상태
 * ------------------------------------------------------------------ */

let regionGroup =
  new THREE.Group();

scene.add(regionGroup);


let interactiveMeshes = [];

let outlinesByCode = {};

let materialsByCode = {};

let labelPosByCode = {};

let hoveredCode = null;


/* ------------------------------------------------------------------ *
 * 3. Camera
 * ------------------------------------------------------------------ */

function getGroundAxes() {
  const azRad =
    THREE.MathUtils.degToRad(
      tiltAzimuth
    );


  const forward =
    new THREE.Vector3(
      Math.sin(azRad),
      0,
      Math.cos(azRad)
    );


  const right =
    new THREE.Vector3(
      Math.cos(azRad),
      0,
      -Math.sin(azRad)
    );


  return {
    forward,
    right,
  };
}


function updateCamera() {
  const elevRad =
    THREE.MathUtils.degToRad(
      ELEVATION_DEG
    );


  const azRad =
    THREE.MathUtils.degToRad(
      tiltAzimuth
    );


  const horizontal =
    CAMERA_DISTANCE *
    Math.cos(elevRad);


  const dir =
    new THREE.Vector3(
      horizontal * Math.sin(azRad),
      CAMERA_DISTANCE * Math.sin(elevRad),
      horizontal * Math.cos(azRad)
    );


  camera.position
    .copy(target)
    .add(dir);


  camera.lookAt(target);
}


updateCamera();


/* ------------------------------------------------------------------ *
 * Camera Controls
 * ------------------------------------------------------------------ */

let isDragging = false;

let dragMoved = false;

let lastPointer = {
  x: 0,
  y: 0,
};


function worldUnitsPerPixel() {
  return (
    (camera.top - camera.bottom) /
    camera.zoom /
    renderer.domElement.clientHeight
  );
}


renderer.domElement.addEventListener(
  "pointerdown",
  (event) => {
    isDragging = true;
    dragMoved = false;

    lastPointer = {
      x: event.clientX,
      y: event.clientY,
    };


    renderer.domElement.setPointerCapture(
      event.pointerId
    );


    // 드래그 시작 시 hover 제거
    setHover(null);

    hideTooltip();
  }
);


renderer.domElement.addEventListener(
  "pointerup",
  (event) => {
    isDragging = false;

    if (
      renderer.domElement.hasPointerCapture(
        event.pointerId
      )
    ) {
      renderer.domElement.releasePointerCapture(
        event.pointerId
      );
    }
  }
);


renderer.domElement.addEventListener(
  "pointercancel",
  () => {
    isDragging = false;
    dragMoved = false;

    setHover(null);
    hideTooltip();
  }
);


renderer.domElement.addEventListener(
  "pointermove",
  (event) => {
    /*
     * 드래그 중에는 hover를 처리하지 않는다.
     * 지도 이동과 지역 선택 인터랙션을 분리한다.
     */
    if (isDragging) {
      const dx =
        event.clientX -
        lastPointer.x;

      const dy =
        event.clientY -
        lastPointer.y;


      if (
        Math.abs(dx) > 0 ||
        Math.abs(dy) > 0
      ) {
        dragMoved = true;
      }


      lastPointer = {
        x: event.clientX,
        y: event.clientY,
      };


      const {
        forward,
        right,
      } = getGroundAxes();


      const upp =
        worldUnitsPerPixel();


      target.addScaledVector(
        right,
        -dx * upp
      );


      target.addScaledVector(
        forward,
        dy * upp
      );


      updateCamera();


      setHover(null);
      hideTooltip();

      return;
    }


    handleHover(event);
  }
);


renderer.domElement.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();


    const factor =
      Math.exp(
        -event.deltaY * 0.0012
      );


    camera.zoom =
      THREE.MathUtils.clamp(
        camera.zoom * factor,
        ZOOM_MIN,
        ZOOM_MAX
      );


    camera.updateProjectionMatrix();
  },
  {
    passive: false,
  }
);


/* ------------------------------------------------------------------ *
 * UI Controls
 * ------------------------------------------------------------------ */

els.tiltSlider.addEventListener(
  "input",
  () => {
    tiltAzimuth =
      Number(
        els.tiltSlider.value
      );

    updateCamera();
  }
);


els.heightSlider.addEventListener(
  "input",
  () => {
    maxExtrudeHeight =
      Number(
        els.heightSlider.value
      );

    els.heightValue.textContent =
      maxExtrudeHeight;

    render();
  }
);


/* ------------------------------------------------------------------ *
 * Resize
 * ------------------------------------------------------------------ */

function onResize() {
  const w =
    Math.max(
      1,
      els.host.clientWidth
    );

  const h =
    Math.max(
      1,
      els.host.clientHeight
    );


  const aspect =
    w / h;


  camera.left =
    -VIEW_HALF_HEIGHT *
    aspect;

  camera.right =
    VIEW_HALF_HEIGHT *
    aspect;

  camera.top =
    VIEW_HALF_HEIGHT;

  camera.bottom =
    -VIEW_HALF_HEIGHT;


  camera.updateProjectionMatrix();

  renderer.setSize(w, h);

  updateLabels();
}


window.addEventListener(
  "resize",
  onResize
);


/* ------------------------------------------------------------------ *
 * Screen Position
 * ------------------------------------------------------------------ */

function screenPosition(worldPos) {
  const p =
    worldPos
      .clone()
      .project(camera);


  return {
    x:
      (p.x * 0.5 + 0.5) *
      renderer.domElement.clientWidth,

    y:
      (-p.y * 0.5 + 0.5) *
      renderer.domElement.clientHeight,
  };
}


function updateLabels() {
  Object.entries(
    labelPosByCode
  ).forEach(
    ([code, info]) => {
      const p =
        screenPosition(
          info.pos
        );


      info.el.style.transform =
        `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  );
}


/* ------------------------------------------------------------------ *
 * Animation
 * ------------------------------------------------------------------ */

function animate() {
  requestAnimationFrame(
    animate
  );

  renderer.render(
    scene,
    camera
  );

  updateLabels();
}


animate();


/* ------------------------------------------------------------------ *
 * 4. GeoJSON → Projection
 * ------------------------------------------------------------------ */

function computeBounds(
  featureCollection
) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;


  const walk = (
    coords,
    depth
  ) => {
    if (depth === 0) {
      const [
        lon,
        lat,
      ] = coords;


      if (lon < minLon) {
        minLon = lon;
      }

      if (lon > maxLon) {
        maxLon = lon;
      }

      if (lat < minLat) {
        minLat = lat;
      }

      if (lat > maxLat) {
        maxLat = lat;
      }

      return;
    }


    coords.forEach(
      (c) =>
        walk(
          c,
          depth - 1
        )
    );
  };


  featureCollection.features.forEach(
    (feature) => {
      const depth =
        feature.geometry.type ===
        "Polygon"
          ? 2
          : 3;


      walk(
        feature.geometry.coordinates,
        depth
      );
    }
  );


  return {
    minLon,
    maxLon,
    minLat,
    maxLat,
  };
}


function makeProjector(
  bounds
) {
  const lonMid =
    (bounds.minLon +
      bounds.maxLon) /
    2;


  const latMid =
    (bounds.minLat +
      bounds.maxLat) /
    2;


  const lonRange =
    Math.max(
      0.000001,
      bounds.maxLon -
        bounds.minLon
    );


  const scale =
    210 / lonRange;


  const cosLat =
    Math.cos(
      (latMid * Math.PI) /
        180
    );


  return (
    lon,
    lat
  ) => [
    (lon - lonMid) *
      cosLat *
      scale,

    (lat - latMid) *
      scale,
  ];
}


/* ------------------------------------------------------------------ *
 * GeoJSON Polygon → Shape
 * ------------------------------------------------------------------ */

function ringToShape(
  rings,
  project
) {
  const [
    outer,
    ...holes
  ] = rings;


  if (
    !outer ||
    outer.length < 3
  ) {
    return null;
  }


  const shape =
    new THREE.Shape(
      outer.map(
        ([lon, lat]) => {
          const [
            x,
            y,
          ] =
            project(
              lon,
              lat
            );

          return new THREE.Vector2(
            x,
            y
          );
        }
      )
    );


  holes.forEach(
    (hole) => {
      if (
        hole.length < 3
      ) {
        return;
      }


      const path =
        new THREE.Path(
          hole.map(
            ([lon, lat]) => {
              const [
                x,
                y,
              ] =
                project(
                  lon,
                  lat
                );

              return new THREE.Vector2(
                x,
                y
              );
            }
          )
        );


      shape.holes.push(
        path
      );
    }
  );


  return shape;
}


/* ------------------------------------------------------------------ *
 * Polygon Centroid
 *
 * 반드시 project()가 적용된 좌표를 입력한다.
 * ------------------------------------------------------------------ */

function ringCentroidAndArea(
  points
) {
  let area = 0;
  let cx = 0;
  let cy = 0;


  for (
    let i = 0;
    i < points.length;
    i++
  ) {
    const [
      x0,
      y0,
    ] = points[i];


    const [
      x1,
      y1,
    ] =
      points[
        (i + 1) %
          points.length
      ];


    const cross =
      x0 * y1 -
      x1 * y0;


    area += cross;

    cx +=
      (x0 + x1) *
      cross;

    cy +=
      (y0 + y1) *
      cross;
  }


  area *= 0.5;


  if (
    Math.abs(area) <
    1e-9
  ) {
    const n =
      points.length;


    const sx =
      points.reduce(
        (sum, p) =>
          sum + p[0],
        0
      ) / n;


    const sy =
      points.reduce(
        (sum, p) =>
          sum + p[1],
        0
      ) / n;


    return {
      x: sx,
      y: sy,
      area: 0,
    };
  }


  return {
    x:
      cx /
      (6 * area),

    y:
      cy /
      (6 * area),

    area:
      Math.abs(area),
  };
}


/* ------------------------------------------------------------------ *
 * Color
 * ------------------------------------------------------------------ */

function mixColor(t) {
  t =
    Math.min(
      1,
      Math.max(0, t)
    );


  const color =
    new THREE.Color();


  if (t < 0.5) {
    color.lerpColors(
      new THREE.Color(
        COLOR_LOW
      ),
      new THREE.Color(
        COLOR_MID
      ),
      t / 0.5
    );
  } else {
    color.lerpColors(
      new THREE.Color(
        COLOR_MID
      ),
      new THREE.Color(
        COLOR_HIGH
      ),
      (t - 0.5) /
        0.5
    );
  }


  return color;
}


/* ------------------------------------------------------------------ *
 * Feature Code
 *
 * 현재 GeoJSON의 실제 코드 필드를 우선 확인하고,
 * 혹시 데이터 구조가 달라져도 대응할 수 있도록 fallback을 둔다.
 * ------------------------------------------------------------------ */

function getFeatureCode(
  feature
) {
  const props =
    feature.properties ?? {};


  const rawCode =
    props.sidocd ??
    props.sido_cd ??
    props.SIDO_CD ??
    props.cd ??
    props.CD;


  if (
    rawCode ===
      undefined ||
    rawCode === null
  ) {
    return null;
  }


  return String(
    rawCode
  ).padStart(
    2,
    "0"
  );
}


/* ------------------------------------------------------------------ *
 * Hover Outline
 *
 * 중요:
 * ExtrudeGeometry → EdgesGeometry를 사용하지 않는다.
 *
 * GeoJSON의 원본 outer ring을 직접 LineLoop으로 만들어
 * 실제 행정구역 경계만 강조한다.
 * ------------------------------------------------------------------ */

function createOutline(
  ring,
  project,
  height
) {
  if (
    !ring ||
    ring.length < 3
  ) {
    return null;
  }


  const points =
    ring.map(
      ([lon, lat]) => {
        const [
          x,
          y,
        ] =
          project(
            lon,
            lat
          );


        /*
         * ExtrudeGeometry를 rotateX(-PI/2) 했기 때문에
         * Shape의 y축은 World의 -Z 방향이다.
         *
         * 따라서 outline 역시:
         *
         * x → x
         * y → -z
         */
        return new THREE.Vector3(
          x,
          height + 0.18,
          -y
        );
      }
    );


  const geometry =
    new THREE.BufferGeometry().setFromPoints(
      points
    );


  const material =
    new THREE.LineBasicMaterial({
      color:
        HIGHLIGHT_COLOR,

      transparent: true,

      opacity: 0.82,

      depthTest: true,

      depthWrite: false,
    });


  const line =
    new THREE.LineLoop(
      geometry,
      material
    );


  line.renderOrder = 10;

  line.visible = false;


  return line;
}


/* ------------------------------------------------------------------ *
 * Group Dispose
 * ------------------------------------------------------------------ */

function disposeGroup(
  group
) {
  group.traverse(
    (obj) => {
      if (
        obj.isMesh ||
        obj.isLine ||
        obj.isLineSegments
      ) {
        if (
          obj.geometry
        ) {
          obj.geometry.dispose();
        }


        if (
          obj.material
        ) {
          if (
            Array.isArray(
              obj.material
            )
          ) {
            obj.material.forEach(
              (material) =>
                material.dispose()
            );
          } else {
            obj.material.dispose();
          }
        }
      }
    }
  );
}


/* ------------------------------------------------------------------ *
 * 5. Terrain Build
 * ------------------------------------------------------------------ */

function buildTerrain(
  featureCollection,
  valueByCode
) {
  const bounds =
    computeBounds(
      featureCollection
    );


  const project =
    makeProjector(
      bounds
    );


  const maxValue =
    Math.max(
      1,
      ...Object.values(
        valueByCode
      ).map(
        (entry) =>
          entry.value
      )
    );


  const newGroup =
    new THREE.Group();


  const meshes = [];

  const outlines = {};

  const materials = {};

  const bestCentroid = {};


  featureCollection.features.forEach(
    (feature) => {
      const code =
        getFeatureCode(
          feature
        );


      if (!code) {
        console.warn(
          "시도 코드가 없는 feature:",
          feature.properties
        );

        return;
      }


      const entry =
        valueByCode[
          code
        ];


      /*
       * 지도에는 존재하지만 data.json에는 없는 코드.
       *
       * 현재 코드 매핑을 점검할 때 매우 유용하므로
       * console.warn으로 남긴다.
       */
      if (!entry) {
        console.warn(
          "valueByCode에 없는 지도 코드:",
          {
            code,
            properties:
              feature.properties,
          }
        );

        return;
      }


      const t =
        entry.value /
        maxValue;


      const height =
        MIN_HEIGHT_FLOOR +
        Math.pow(
          t,
          0.62
        ) *
          maxExtrudeHeight;


      const color =
        mixColor(t);


      /*
       * 지역별 material을 하나만 만든다.
       */
      const material =
        materials[code] ??
        new THREE.MeshStandardMaterial(
          {
            color,
            roughness: 0.55,
            metalness: 0.05,
            flatShading: true,

            emissive:
              new THREE.Color(
                0x000000
              ),

            emissiveIntensity: 0,
          }
        );


      materials[code] =
        material;


      const polygons =
        feature.geometry.type ===
        "Polygon"
          ? [
              feature.geometry
                .coordinates,
            ]
          : feature.geometry
              .coordinates;


      polygons.forEach(
        (rings) => {
          const shape =
            ringToShape(
              rings,
              project
            );


          if (!shape) {
            return;
          }


          /* --------------------------------------------------------
           * 3D 지역
           * -------------------------------------------------------- */

          const geometry =
            new THREE.ExtrudeGeometry(
              shape,
              {
                depth:
                  height,

                bevelEnabled:
                  false,

                steps: 1,
              }
            );


          geometry.rotateX(
            -Math.PI / 2
          );


          geometry.computeVertexNormals();


          const mesh =
            new THREE.Mesh(
              geometry,
              material
            );


          mesh.userData = {
            name:
              entry.name,

            value:
              entry.value,

            code,
          };


          newGroup.add(
            mesh
          );


          meshes.push(
            mesh
          );


          /* --------------------------------------------------------
           * 실제 GeoJSON 외곽선 기반 Highlight
           *
           * 기존:
           *
           * ExtrudeGeometry
           *       ↓
           * EdgesGeometry
           *
           * 를 완전히 제거했다.
           *
           * 이제 GeoJSON outer ring을 직접 사용한다.
           * -------------------------------------------------------- */

          const outline =
            createOutline(
              rings[0],
              project,
              height
            );


          if (outline) {
            newGroup.add(
              outline
            );


            (
              outlines[code] ??=
                []
            ).push(
              outline
            );
          }


          /* --------------------------------------------------------
           * Label Position
           *
           * 원본 lon/lat가 아니라 projection 이후의 좌표로
           * centroid를 계산한다.
           * -------------------------------------------------------- */

          const projectedRing =
            rings[0].map(
              ([lon, lat]) =>
                project(
                  lon,
                  lat
                )
            );


          const {
            x,
            y,
            area,
          } =
            ringCentroidAndArea(
              projectedRing
            );


          /*
           * MultiPolygon / 섬이 여러 개 있는 경우
           * 가장 넓은 polygon을 라벨 기준으로 사용한다.
           */
          if (
            !bestCentroid[
              code
            ] ||
            area >
              bestCentroid[
                code
              ].area
          ) {
            bestCentroid[
              code
            ] = {
              x,
              y,
              area,
              height,

              name:
                entry.name,
            };
          }
        }
      );
    }
  );


  return {
    group:
      newGroup,

    meshes,

    outlines,

    materials,

    maxValue,

    bestCentroid,
  };
}


/* ------------------------------------------------------------------ *
 * 6. Labels
 * ------------------------------------------------------------------ */

function rebuildLabels(
  bestCentroid
) {
  els.labelsLayer.innerHTML =
    "";

  labelPosByCode = {};


  Object.entries(
    bestCentroid
  ).forEach(
    ([code, info]) => {
      const el =
        document.createElement(
          "div"
        );


      el.className =
        "region-label";


      /*
       * 지역 이름을 별도의 CODE_TO_SHORT에서 찾지 않고
       * GeoJSON/data 매핑 단계에서 저장한 이름을 사용한다.
       */
      el.textContent =
        info.name;


      els.labelsLayer.appendChild(
        el
      );


      const worldPos =
        new THREE.Vector3(
          info.x,
          info.height + 1.5,
          -info.y
        );


      labelPosByCode[
        code
      ] = {
        el,
        pos: worldPos,
      };
    }
  );
}


/* ------------------------------------------------------------------ *
 * 7. Data Loading
 * ------------------------------------------------------------------ */

let CASE_DATA = null;

let SIDO_MAP = null;


async function loadCaseData() {
  const res =
    await fetch(
      "./data.json"
    );


  if (!res.ok) {
    throw new Error(
      `data.json을 불러오지 못했습니다 (HTTP ${res.status})`
    );
  }


  return res.json();
}


async function loadSidoMap() {
  if (SIDO_MAP) {
    return SIDO_MAP;
  }


  SIDO_MAP =
    await adk.get(
      MAP_VERSION,
      "sido"
    );


  return SIDO_MAP;
}


/* ------------------------------------------------------------------ *
 * data.json → Code Lookup
 * ------------------------------------------------------------------ */

function buildValueByCode(
  year,
  disease
) {
  const values =
    CASE_DATA[
      year
    ][
      disease
    ];


  const lookup = {};


  REGION_META.forEach(
    (meta, i) => {
      /*
       * values[0] = 전국
       *
       * values[1] = 서울
       * values[2] = 부산
       * ...
       * values[16] = 전남·광주
       */
      const value =
        values[i + 1] ??
        0;


      lookup[
        meta.code
      ] = {
        name:
          meta.name,

        value,
      };
    }
  );


  return {
    lookup,
    total:
      values[0],
  };
}


/* ------------------------------------------------------------------ *
 * 8. Render
 * ------------------------------------------------------------------ */

async function render() {
  const year =
    els.yearSelect.value;

  const disease =
    els.diseaseSelect.value;


  if (
    !CASE_DATA ||
    !disease
  ) {
    return;
  }


  hideError();


  const needsFetch =
    !SIDO_MAP;


  if (needsFetch) {
    setLoading(
      true,
      "시도 경계 데이터를 가져오는 중…"
    );
  }


  let fc;


  try {
    fc =
      await loadSidoMap();
  } catch (err) {
    console.error(err);


    showError(
      `admdongkor 라이브러리에서 시도 경계를 가져오지 못했습니다.\n` +
      `네트워크/CORS 문제일 수 있습니다. 콘솔의 에러 메시지를 확인해 주세요.\n` +
      `(${err.message || err})`
    );


    return;
  }


  setLoading(false);


  const {
    lookup,
    total,
  } =
    buildValueByCode(
      year,
      disease
    );


  const {
    group,
    meshes,
    outlines,
    materials,
    maxValue,
    bestCentroid,
  } =
    buildTerrain(
      fc,
      lookup
    );


  disposeGroup(
    regionGroup
  );


  scene.remove(
    regionGroup
  );


  regionGroup =
    group;


  scene.add(
    regionGroup
  );


  interactiveMeshes =
    meshes;


  outlinesByCode =
    outlines;


  materialsByCode =
    materials;


  hoveredCode =
    null;


  rebuildLabels(
    bestCentroid
  );


  els.total.textContent =
    total.toLocaleString(
      "ko-KR"
    );


  els.legendMax.textContent =
    maxValue.toLocaleString(
      "ko-KR"
    );
}


/* ------------------------------------------------------------------ *
 * 9. Tooltip
 * ------------------------------------------------------------------ */

function hideTooltip() {
  els.tooltip.classList.add(
    "hidden"
  );
}


/*
 * Tooltip을 마우스 위치에 표시하되
 * 화면 밖으로 잘리지 않도록 보정한다.
 */
function showTooltip(
  event
) {
  els.tooltip.classList.remove(
    "hidden"
  );


  /*
   * 먼저 임시 위치를 넣는다.
   * getBoundingClientRect()를 통해 실제 크기를 얻는다.
   */
  const offset = 16;

  let left =
    event.clientX +
    offset;

  let top =
    event.clientY +
    offset;


  const rect =
    els.tooltip.getBoundingClientRect();


  const viewportWidth =
    window.innerWidth;

  const viewportHeight =
    window.innerHeight;


  if (
    left + rect.width >
    viewportWidth - 8
  ) {
    left =
      event.clientX -
      rect.width -
      offset;
  }


  if (
    top + rect.height >
    viewportHeight - 8
  ) {
    top =
      event.clientY -
      rect.height -
      offset;
  }


  left =
    Math.max(
      8,
      left
    );


  top =
    Math.max(
      8,
      top
    );


  els.tooltip.style.left =
    `${left}px`;


  els.tooltip.style.top =
    `${top}px`;
}


/* ------------------------------------------------------------------ *
 * 10. Hover
 * ------------------------------------------------------------------ */

function setHover(
  code
) {
  if (
    code ===
    hoveredCode
  ) {
    return;
  }


  /* --------------------------------------------------------------
   * 이전 hover 제거
   * -------------------------------------------------------------- */

  if (
    hoveredCode &&
    outlinesByCode[
      hoveredCode
    ]
  ) {
    outlinesByCode[
      hoveredCode
    ].forEach(
      (outline) => {
        outline.visible =
          false;
      }
    );


    const oldMaterial =
      materialsByCode[
        hoveredCode
      ];


    if (oldMaterial) {
      oldMaterial.emissive.setHex(
        0x000000
      );

      oldMaterial.emissiveIntensity =
        0;
    }
  }


  hoveredCode =
    code;


  /* --------------------------------------------------------------
   * 새 hover 적용
   * -------------------------------------------------------------- */

  if (
    hoveredCode &&
    outlinesByCode[
      hoveredCode
    ]
  ) {
    outlinesByCode[
      hoveredCode
    ].forEach(
      (outline) => {
        outline.visible =
          true;
      }
    );


    const material =
      materialsByCode[
        hoveredCode
      ];


    if (material) {
      /*
       * 데이터 색상 자체를 바꾸지 않고
       * 아주 약한 emissive만 추가한다.
       */
      material.emissive.setHex(
        0x2a1c08
      );

      material.emissiveIntensity =
        0.12;
    }
  }
}


function handleHover(
  event
) {
  /*
   * 드래그 중에는 hover를 절대 처리하지 않는다.
   */
  if (isDragging) {
    setHover(null);
    hideTooltip();

    return;
  }


  const rect =
    renderer.domElement.getBoundingClientRect();


  pointer.x =
    (
      (event.clientX -
        rect.left) /
      rect.width
    ) *
      2 -
    1;


  pointer.y =
    -(
      (
        event.clientY -
        rect.top
      ) /
      rect.height
    ) *
      2 +
    1;


  raycaster.setFromCamera(
    pointer,
    camera
  );


  const hit =
    raycaster.intersectObjects(
      interactiveMeshes,
      false
    )[0];


  if (!hit) {
    setHover(null);
    hideTooltip();

    return;
  }


  const code =
    hit.object.userData.code;


  setHover(code);


  els.tooltipName.textContent =
    hit.object.userData.name;


  els.tooltipValue.textContent =
    `${hit.object.userData.value.toLocaleString("ko-KR")}건`;


  /*
   * 이제 전남·광주도 별도의 통합값 안내를 표시하지 않는다.
   *
   * 필요하다면 향후 data.json의 메타데이터로
   * 별도 설명을 넣을 수 있다.
   */
  els.tooltipNote.textContent =
    "";


  showTooltip(event);
}


/* ------------------------------------------------------------------ *
 * Pointer Leave
 * ------------------------------------------------------------------ */

renderer.domElement.addEventListener(
  "pointerleave",
  () => {
    /*
     * 드래그 상태가 아니면 hover를 제거한다.
     */
    if (!isDragging) {
      setHover(null);
      hideTooltip();
    }
  }
);


/* ------------------------------------------------------------------ *
 * 11. Raycaster
 * ------------------------------------------------------------------ */

const raycaster =
  new THREE.Raycaster();

const pointer =
  new THREE.Vector2();


/* ------------------------------------------------------------------ *
 * 12. Init
 * ------------------------------------------------------------------ */

async function init() {
  /* --------------------------------------------------------------
   * 지도 방향
   * -------------------------------------------------------------- */

  els.tiltSlider.min =
    AZIMUTH_MIN;

  els.tiltSlider.max =
    AZIMUTH_MAX;

  els.tiltSlider.value =
    0;


  /* --------------------------------------------------------------
   * 돌출 높이
   * -------------------------------------------------------------- */

  els.heightSlider.min =
    HEIGHT_MIN;

  els.heightSlider.max =
    HEIGHT_MAX;

  /*
   * 기존 디자인에서 HEIGHT_DEFAULT가 60이므로
   * max가 20이면 브라우저 slider가 제대로 표시되지 않는다.
   *
   * 따라서 실제 max보다 default가 크면 max를 자동으로 확장한다.
   */
  if (
    HEIGHT_DEFAULT >
    HEIGHT_MAX
  ) {
    els.heightSlider.max =
      HEIGHT_DEFAULT;
  }


  els.heightSlider.value =
    HEIGHT_DEFAULT;


  maxExtrudeHeight =
    HEIGHT_DEFAULT;


  els.heightValue.textContent =
    HEIGHT_DEFAULT;


  /* --------------------------------------------------------------
   * data.json
   * -------------------------------------------------------------- */

  try {
    CASE_DATA =
      await loadCaseData();
  } catch (err) {
    showError(
      `data.json을 불러오지 못했습니다.\n` +
      `(${err.message || err})`
    );

    return;
  }


  /* --------------------------------------------------------------
   * 질병 목록
   * -------------------------------------------------------------- */

  const yearData =
    CASE_DATA[
      els.yearSelect.value
    ] ??
    CASE_DATA["2021"];


  const diseases =
    Object.keys(
      yearData ?? {}
    );


  els.diseaseSelect.innerHTML =
    diseases
      .map(
        (disease) =>
          `<option value="${disease}">${disease}</option>`
      )
      .join("");


  /* --------------------------------------------------------------
   * Select Events
   * -------------------------------------------------------------- */

  els.yearSelect.addEventListener(
    "change",
    render
  );


  els.diseaseSelect.addEventListener(
    "change",
    render
  );


  /* --------------------------------------------------------------
   * Start
   * -------------------------------------------------------------- */

  onResize();

  await render();
}


init();