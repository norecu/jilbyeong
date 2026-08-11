import * as THREE from "three";
import * as adk from "https://esm.sh/admdongkor";

/* ================================================================
1. 지역 / 데이터 코드

---

data.json의 각 배열 순서:

[전국, 서울, 부산, 대구, 인천, 대전, 울산, 경기,
강원, 충북, 충남, 전북, 경북, 경남, 제주, 세종, 전남광주]

지도상의 최신 시도 코드:
  11: 서울
  12: 전남광주

  26: 부산
  27: 대구
  28: 인천

  30: 대전
  31: 울산
  36: 세종

  41: 경기
  43: 충북
  44: 충남
  47: 경북
  48: 경남

  50: 제주
  51: 강원
  52: 전북
================================================================ */

const REGION_META = [
  { name: "서울", code: "11" },
  { name: "전남·광주", code: "12" },
  { name: "부산", code: "26" },
  { name: "대구", code: "27" },
  { name: "인천", code: "28" },
  { name: "대전", code: "30" },
  { name: "울산", code: "31" },
  { name: "세종", code: "36" },
  { name: "경기", code: "41" },
  { name: "충북", code: "43" },
  { name: "충남", code: "44" },
  { name: "경북", code: "47" },
  { name: "경남", code: "48" },
  { name: "제주", code: "50" },
  { name: "강원", code: "51" },
  { name: "전북", code: "52" },
];

const CODE_TO_SHORT = {
  11: "서울",
  12: "전남·광주",
  26: "부산",
  27: "대구",
  28: "인천",
  30: "대전",
  31: "울산",
  36: "세종",
  41: "경기",
  43: "충북",
  44: "충남",
  47: "경북",
  48: "경남",
  50: "제주",
  51: "강원",
  52: "전북",
};

/* ================================================================
지도 / 돌출 설정
================================================================ */

const MAP_VERSION = "20260701";

const HEIGHT_MIN = 5;
const HEIGHT_MAX = 120;
const HEIGHT_DEFAULT = 30;

const MIN_HEIGHT_FLOOR = 1.2;

const COLOR_LOW = 0x2c6e63;
const COLOR_MID = 0xf2c14e;
const COLOR_HIGH = 0xff6b4a;

const HIGHLIGHT_COLOR = 0xffe9a8;

// 기본 지역 경계선
const BASE_OUTLINE_COLOR = 0xb7c4bd;
const BASE_OUTLINE_OPACITY = 0.3;

// Hover 경계선
const HOVER_OUTLINE_OPACITY = 0.98;

const TERRAIN_ANIMATION_DURATION = 900;

let terrainAnimationFrame = null;

/* ================================================================
카메라
================================================================ */

const ELEVATION_DEFAULT = 85;
const ELEVATION_MIN = 55;
const ELEVATION_MAX = 89;

const AZIMUTH_DEFAULT = 0;
const AZIMUTH_MIN = -20;
const AZIMUTH_MAX = 20;

const CAMERA_DISTANCE = 420;

const VIEW_HALF_HEIGHT = 128;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.2;

let cameraElevation = ELEVATION_DEFAULT;
let tiltAzimuth = AZIMUTH_DEFAULT;
let maxExtrudeHeight = HEIGHT_DEFAULT;

/* ================================================================
DOM
================================================================ */

const els = {
  host: document.getElementById("canvas-host"),

  labelsLayer: document.getElementById("labels-layer"),

  loading: document.getElementById("loading"),

  errorPanel: document.getElementById("error-panel"),

  errorBody: document.querySelector("#error-panel .error-panel__body"),

  yearButtons: document.getElementById("year-buttons"),

  diseaseButtons: document.getElementById("disease-buttons"),

  total: document.getElementById("total-value"),
  totalName: document.getElementById("total-name"),

  legendMax: document.getElementById("legend-max"),

  tooltip: document.getElementById("tooltip"),

  tooltipName: document.querySelector(".tooltip__name"),

  tooltipValue: document.querySelector(".tooltip__value"),

  tooltipNote: document.querySelector(".tooltip__note"),

  diseaseDescriptionTitle: document.getElementById("disease-description-title"),

  diseaseDescriptionBody: document.getElementById("disease-description-body"),

  cameraElevationSlider: document.getElementById("camera-elevation-slider"),

  cameraElevationValue: document.getElementById("camera-elevation-value"),

  cameraAzimuthSlider: document.getElementById("camera-azimuth-slider"),

  cameraAzimuthValue: document.getElementById("camera-azimuth-value"),

  cameraHeightSlider: document.getElementById("camera-height-slider"),

  cameraHeightValue: document.getElementById("camera-height-value"),
};

/* ================================================================
질병 설명

나중에 이 부분만 네 실제 설명으로 채우면 됨.
================================================================ */

const DISEASE_DESCRIPTIONS = {
  /*
"질병명":
"여기에 질병에 대한 설명을 입력합니다.",

"다른 질병":
"여기에 다른 질병에 대한 설명을 입력합니다.",
*/
};

function updateDiseaseDescription(disease) {
  if (!els.diseaseDescriptionTitle) {
    return;
  }

  els.diseaseDescriptionTitle.textContent = disease || "질병 설명";

  els.diseaseDescriptionBody.textContent =
    DISEASE_DESCRIPTIONS[disease] ??
    "선택한 감염병에 대한 설명이 이곳에 표시됩니다.";
}

/* ================================================================
Loading / Error
================================================================ */

function setLoading(isLoading, message) {
  if (message) {
    const p = els.loading.querySelector("p");

    if (p) {
      p.textContent = message;
    }
  }

  els.loading.classList.toggle("hidden", !isLoading);
}

function showError(message) {
  els.errorBody.textContent = message;

  els.errorPanel.classList.remove("hidden");

  setLoading(false);
}

function hideError() {
  els.errorPanel.classList.add("hidden");
}

/* ================================================================
Three.js Scene
================================================================ */

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x0a0f0d);

scene.fog = new THREE.Fog(0x0a0f0d, 300, 700);

const aspect0 = els.host.clientWidth / els.host.clientHeight;

const camera = new THREE.OrthographicCamera(
  -VIEW_HALF_HEIGHT * aspect0,
  VIEW_HALF_HEIGHT * aspect0,
  VIEW_HALF_HEIGHT,
  -VIEW_HALF_HEIGHT,
  0.1,
  2000,
);

const target = new THREE.Vector3(0, 8, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

renderer.setSize(els.host.clientWidth, els.host.clientHeight);

els.host.appendChild(renderer.domElement);

/* ================================================================
Lighting
================================================================ */

scene.add(new THREE.AmbientLight(0x8fa79b, 0.6));

const sun = new THREE.DirectionalLight(0xfff2df, 1.05);

sun.position.set(140, 260, 120);

scene.add(sun);

const rim = new THREE.DirectionalLight(0x2c6e63, 0.35);

rim.position.set(-160, 80, -140);

scene.add(rim);

/* ================================================================
바닥
================================================================ */

const grid = new THREE.GridHelper(340, 34, 0x223029, 0x152019);

grid.position.y = -0.6;

scene.add(grid);

const plate = new THREE.Mesh(
  new THREE.CylinderGeometry(160, 160, 1.2, 64),
  new THREE.MeshStandardMaterial({
    color: 0x0d1512,
    roughness: 1,
  }),
);

plate.position.y = -1.2;

scene.add(plate);

/* ================================================================
지도 상태
================================================================ */

let regionGroup = new THREE.Group();

scene.add(regionGroup);

let interactiveMeshes = [];

let outlinesByCode = {};

let materialsByCode = {};

let labelPosByCode = {};

let hoveredCode = null;
let selectedCode = null;
let selectedTooltipPosition = null;

const SELECTED_COLOR = 0xff8a3d;

/* ================================================================
Camera
================================================================ */

function getGroundAxes() {
  const azRad = THREE.MathUtils.degToRad(tiltAzimuth);

  const forward = new THREE.Vector3(Math.sin(azRad), 0, Math.cos(azRad));

  const right = new THREE.Vector3(Math.cos(azRad), 0, -Math.sin(azRad));

  return {
    forward,
    right,
  };
}

function updateCamera() {
  const elevRad = THREE.MathUtils.degToRad(cameraElevation);

  const azRad = THREE.MathUtils.degToRad(tiltAzimuth);

  const horizontal = CAMERA_DISTANCE * Math.cos(elevRad);

  const dir = new THREE.Vector3(
    horizontal * Math.sin(azRad),

    CAMERA_DISTANCE * Math.sin(elevRad),

    horizontal * Math.cos(azRad),
  );

  camera.position.copy(target).add(dir);

  camera.lookAt(target);
}

updateCamera();

/* ================================================================
Map Controls
================================================================ */

/* ================================================================
Map Controls
================================================================ */

let isDragging = false;
let didDrag = false;

let lastPointer = {
  x: 0,
  y: 0,
};

let pointerDownPosition = {
  x: 0,
  y: 0,
};

const DRAG_THRESHOLD = 4;

function worldUnitsPerPixel() {
  return (
    (camera.top - camera.bottom) /
    camera.zoom /
    renderer.domElement.clientHeight
  );
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  isDragging = true;
  didDrag = false;

  lastPointer = {
    x: event.clientX,
    y: event.clientY,
  };

  pointerDownPosition = {
    x: event.clientX,
    y: event.clientY,
  };

  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", (event) => {
  handleHover(event);

  if (!isDragging) {
    return;
  }

  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;

  const totalDx = event.clientX - pointerDownPosition.x;
  const totalDy = event.clientY - pointerDownPosition.y;

  if (
    Math.abs(totalDx) > DRAG_THRESHOLD ||
    Math.abs(totalDy) > DRAG_THRESHOLD
  ) {
    didDrag = true;
  }

  lastPointer = {
    x: event.clientX,
    y: event.clientY,
  };

  const { forward, right } = getGroundAxes();
  const upp = worldUnitsPerPixel();

  /*
   * 좌우 이동
   *
   * 마우스를 오른쪽으로 움직이면
   * 지도가 오른쪽으로 따라오는 느낌
   */
  target.addScaledVector(right, -dx * upp);

  /*
   * 상하 이동
   *
   * 현재 카메라가 보는 방향을 기준으로 이동.
   * 기존 방식보다 상하 움직임을 안정적으로 처리.
   */
  target.addScaledVector(forward, -dy * upp);

  updateCamera();
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!didDrag) {
    handleClick(event);
  }

  isDragging = false;

  try {
    renderer.domElement.releasePointerCapture(event.pointerId);
  } catch {
    // 이미 release된 경우 무시
  }
});

renderer.domElement.addEventListener("pointercancel", () => {
  isDragging = false;
  didDrag = false;
});

renderer.domElement.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();

    const factor = Math.exp(-event.deltaY * 0.0012);

    camera.zoom = THREE.MathUtils.clamp(
      camera.zoom * factor,
      ZOOM_MIN,
      ZOOM_MAX,
    );

    camera.updateProjectionMatrix();
  },
  {
    passive: false,
  },
);

/* ================================================================
Camera UI
================================================================ */

function setupCameraControls() {
  if (els.cameraElevationSlider) {
    els.cameraElevationSlider.min = ELEVATION_MIN;

    els.cameraElevationSlider.max = ELEVATION_MAX;

    els.cameraElevationSlider.value = ELEVATION_DEFAULT;

    els.cameraElevationSlider.addEventListener("input", () => {
      cameraElevation = Number(els.cameraElevationSlider.value);

      els.cameraElevationValue.textContent = `${cameraElevation}°`;

      updateCamera();
    });
  }

  if (els.cameraAzimuthSlider) {
    els.cameraAzimuthSlider.min = AZIMUTH_MIN;

    els.cameraAzimuthSlider.max = AZIMUTH_MAX;

    els.cameraAzimuthSlider.value = AZIMUTH_DEFAULT;

    els.cameraAzimuthSlider.addEventListener("input", () => {
      tiltAzimuth = Number(els.cameraAzimuthSlider.value);

      els.cameraAzimuthValue.textContent = `${tiltAzimuth}°`;

      updateCamera();
    });
  }

  if (els.cameraHeightSlider) {
    els.cameraHeightSlider.min = HEIGHT_MIN;

    els.cameraHeightSlider.max = HEIGHT_MAX;

    els.cameraHeightSlider.value = HEIGHT_DEFAULT;

    els.cameraHeightSlider.addEventListener("input", () => {
      maxExtrudeHeight = Number(els.cameraHeightSlider.value);

      els.cameraHeightValue.textContent = maxExtrudeHeight;

      render();
    });
  }
}

/* ================================================================
Resize
================================================================ */

function onResize() {
  const w = els.host.clientWidth;

  const h = els.host.clientHeight;

  if (!w || !h) {
    return;
  }

  const aspect = w / h;

  camera.left = -VIEW_HALF_HEIGHT * aspect;

  camera.right = VIEW_HALF_HEIGHT * aspect;

  camera.top = VIEW_HALF_HEIGHT;

  camera.bottom = -VIEW_HALF_HEIGHT;

  camera.updateProjectionMatrix();

  renderer.setSize(w, h);

  updateLabels();
}

window.addEventListener("resize", onResize);

/* ================================================================
Label
================================================================ */

function screenPosition(worldPos) {
  const p = worldPos.clone().project(camera);

  return {
    x: (p.x * 0.5 + 0.5) * renderer.domElement.clientWidth,

    y: (-p.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
  };
}

function updateLabels() {
  Object.entries(labelPosByCode).forEach(([code, info]) => {
    const p = screenPosition(info.pos);

    info.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
  });

  // 클릭 선택된 지역의 툴팁을 지도 위치에 계속 고정
  if (selectedCode && selectedTooltipPosition) {
    const p = screenPosition(selectedTooltipPosition);

    els.tooltip.style.left = `${p.x}px`;
    els.tooltip.style.top = `${p.y}px`;
  }
}

function animate() {
  requestAnimationFrame(animate);

  renderer.render(scene, camera);

  updateLabels();
}

animate();

/* ================================================================
GeoJSON Bounds
================================================================ */

function computeBounds(featureCollection) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const walk = (coords, depth) => {
    if (depth === 0) {
      const [lon, lat] = coords;

      if (lon < minLon) minLon = lon;

      if (lon > maxLon) maxLon = lon;

      if (lat < minLat) minLat = lat;

      if (lat > maxLat) maxLat = lat;

      return;
    }

    coords.forEach((c) => walk(c, depth - 1));
  };

  featureCollection.features.forEach((feature) => {
    const depth = feature.geometry.type === "Polygon" ? 2 : 3;

    walk(feature.geometry.coordinates, depth);
  });

  return {
    minLon,
    maxLon,
    minLat,
    maxLat,
  };
}

/* ================================================================
Projection
================================================================ */

function makeProjector(bounds) {
  const lonMid = (bounds.minLon + bounds.maxLon) / 2;

  const latMid = (bounds.minLat + bounds.maxLat) / 2;

  const scale = 210 / (bounds.maxLon - bounds.minLon);

  const cosLat = Math.cos((latMid * Math.PI) / 180);

  return (lon, lat) => [
    (lon - lonMid) * cosLat * scale,

    (lat - latMid) * scale,
  ];
}

/* ================================================================
Shape
================================================================ */

function ringToShape(rings, project) {
  const [outer, ...holes] = rings;

  if (!outer || outer.length < 3) {
    return null;
  }

  const shape = new THREE.Shape(
    outer.map(([lon, lat]) => new THREE.Vector2(...project(lon, lat))),
  );

  holes.forEach((hole) => {
    if (hole.length < 3) {
      return;
    }

    shape.holes.push(
      new THREE.Path(
        hole.map(([lon, lat]) => new THREE.Vector2(...project(lon, lat))),
      ),
    );
  });

  return shape;
}

/* ================================================================
Centroid
================================================================ */

function ringCentroidAndArea(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];

    const [x1, y1] = points[(i + 1) % points.length];

    const cross = x0 * y1 - x1 * y0;

    area += cross;

    cx += (x0 + x1) * cross;

    cy += (y0 + y1) * cross;
  }

  area *= 0.5;

  if (Math.abs(area) < 1e-9) {
    const n = points.length;

    const sx = points.reduce((s, p) => s + p[0], 0) / n;

    const sy = points.reduce((s, p) => s + p[1], 0) / n;

    return {
      x: sx,
      y: sy,
      area: 0,
    };
  }

  return {
    x: cx / (6 * area),

    y: cy / (6 * area),

    area: Math.abs(area),
  };
}

/* ================================================================
Color
================================================================ */

function mixColor(t) {
  t = Math.min(1, Math.max(0, t));

  const c = new THREE.Color();

  if (t < 0.5) {
    c.lerpColors(
      new THREE.Color(COLOR_LOW),

      new THREE.Color(COLOR_MID),

      t / 0.5,
    );
  } else {
    c.lerpColors(
      new THREE.Color(COLOR_MID),

      new THREE.Color(COLOR_HIGH),

      (t - 0.5) / 0.5,
    );
  }

  return c;
}

/* ================================================================
Dispose
================================================================ */

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.isMesh || obj.isLine || obj.isLineSegments) {
      if (obj.geometry) {
        obj.geometry.dispose();
      }

      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
  });
}

/* ================================================================
Base / Hover Outline

기본 경계와 hover 경계를 별도로 만든다.

기본:
아주 연한 경계가 항상 보임

hover:
해당 지역에만 강한 highlight
================================================================ */

function createRingLine(ring, project, height, options = {}) {
  if (!ring || ring.length < 3) {
    return null;
  }

  const { hover = false } = options;

  const finalHeight = height + (hover ? 0.32 : 0.12);

const points = ring.map(([lon, lat]) => {
  const [x, y] = project(lon, lat);

  return new THREE.Vector3(
    x,
    0,
    -y
  );
});

  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  const material = new THREE.LineBasicMaterial({
    color: hover ? HIGHLIGHT_COLOR : BASE_OUTLINE_COLOR,

    transparent: true,

    opacity: hover ? HOVER_OUTLINE_OPACITY : BASE_OUTLINE_OPACITY,

    depthTest: false,

    depthWrite: false,
  });

  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = hover ? 20 : 10;

  line.visible = !hover;
  line.userData = {
    isTerrainBorder: true,
    finalHeight,
  };

  return line;
}

/* ================================================================
Terrain Build
================================================================ */

function buildTerrain(featureCollection, valueByCode) {
  featureCollection.features.forEach((feat, idx) => {
    console.log(feat.properties.sidocd, "|", feat.properties.sidonm);
  });
  const bounds = computeBounds(featureCollection);

  const project = makeProjector(bounds);

  const maxValue = Math.max(
    1,
    ...Object.values(valueByCode).map((v) => v.value),
  );

  const newGroup = new THREE.Group();

  const meshes = [];

  const outlines = {};

  const materials = {};

  const bestCentroid = {};

  featureCollection.features.forEach((feature) => {
    const rawCode =
      feature.properties.sidocd ??
      feature.properties.sido_cd ??
      feature.properties.SIDO_CD ??
      feature.properties.sidoCode ??
      feature.properties.SIDO_CODE;

    if (rawCode === undefined || rawCode === null) {
      return;
    }

    const code = String(rawCode).padStart(2, "0");

    const entry = valueByCode[code];

    if (!entry) {
      return;
    }

    const t = entry.value / maxValue;

    const height = MIN_HEIGHT_FLOOR + Math.pow(t, 0.62) * maxExtrudeHeight;

    const color = mixColor(t);

    let material = materials[code];

    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72,
        metalness: 0.0,
        flatShading: false,
        transparent: false,
        opacity: 1.0,
        depthWrite: true,
        fog: false,
      });

      materials[code] = material;
    } else {
      material.color.copy(color);
    }

    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;

    polygons.forEach((rings) => {
      const shape = ringToShape(rings, project);

      if (!shape) {
        return;
      }

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1,
        bevelEnabled: false,
        steps: 1,
      });
      geometry.rotateX(-Math.PI / 2);

      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, material);

      mesh.scale.y = 0.001;

      mesh.userData = {
        name: entry.name,
        value: entry.value,
        code,
        maxHeight: height,
      };

      newGroup.add(mesh);

      meshes.push(mesh);

      /*
         기본 경계선:
         모든 지역에 항상 표시
      */

      const baseOutline = createRingLine(rings[0], project, height, {
        hover: false,
      });

      if (baseOutline) {
        newGroup.add(baseOutline);
      }

      /*
         Hover 경계선:
         평소에는 숨겨놓음
      */

      const hoverOutline = createRingLine(rings[0], project, height, {
        hover: true,
      });

      if (hoverOutline) {
        hoverOutline.userData.maxHeight = height;

        newGroup.add(hoverOutline);

        (outlines[code] ??= []).push(hoverOutline);
      }

      /*
         가장 넓은 파트의 중심을
         라벨 위치로 사용
      */

      const projectedRing = rings[0].map(([lon, lat]) => {
        const [x, y] = project(lon, lat);
        return [x, y];
      });
      const { x, y, area } = ringCentroidAndArea(projectedRing);
      if (!bestCentroid[code] || area > bestCentroid[code].area) {
        bestCentroid[code] = { x, y, area, height };
      }
    });
  });

  return {
    group: newGroup,
    meshes,
    outlines,
    materials,
    maxValue,
    bestCentroid,
  };
}

function startTerrainAnimation(meshes) {
  if (terrainAnimationFrame) {
    cancelAnimationFrame(terrainAnimationFrame);
  }

  const startTime = performance.now();

  function animateTerrain(now) {
    const elapsed = now - startTime;

    const progress = Math.min(elapsed / TERRAIN_ANIMATION_DURATION, 1);

    // 지역 면
    meshes.forEach((mesh) => {
      const maxHeight = mesh.userData.maxHeight;

      mesh.scale.y = Math.max(0.001, progress * maxHeight);
    });

    // 지역 border
    regionGroup.traverse((obj) => {
  if (!obj.userData?.isTerrainBorder) {
    return;
  }

  obj.position.y =
    progress * obj.userData.finalHeight;
});

    if (progress < 1) {
      terrainAnimationFrame = requestAnimationFrame(animateTerrain);
    } else {
      terrainAnimationFrame = null;
    }
  }

  terrainAnimationFrame = requestAnimationFrame(animateTerrain);
}

/* ================================================================
Labels
================================================================ */

function rebuildLabels(bestCentroid) {
  els.labelsLayer.innerHTML = "";

  labelPosByCode = {};

  Object.entries(bestCentroid).forEach(([code, c]) => {
    const shortName = CODE_TO_SHORT[Number(code)] || code;

    const el = document.createElement("div");

    el.className = "region-label";
    el.textContent = shortName;

    els.labelsLayer.appendChild(el);

    const worldPos = new THREE.Vector3(c.x, c.height + 1.5, -c.y);

    labelPosByCode[code] = {
      el,
      pos: worldPos,
    };
  });

  updateLabels();
}

/* ================================================================
Data
================================================================ */

let CASE_DATA = null;

let SIDO_MAP = null;

let selectedYear = null;

let selectedDisease = null;

async function loadCaseData() {
  const res = await fetch("./data.json");

  if (!res.ok) {
    throw new Error(`data.json을 불러오지 못했습니다 (HTTP ${res.status})`);
  }

  return res.json();
}

async function loadSidoMap() {
  if (SIDO_MAP) {
    return SIDO_MAP;
  }

  SIDO_MAP = await adk.get(MAP_VERSION, "sido");

  return SIDO_MAP;
}

/* ================================================================
Data -> Code

REGION_META의 data.json 인덱스와
지도상의 시도 코드를 연결한다.

전남·광주는 같은 data index를 공유한다.
================================================================ */

function buildValueByCode(year, disease) {
  const values = CASE_DATA?.[year]?.[disease];

  if (!Array.isArray(values)) {
    return {
      lookup: {},
      total: 0,
    };
  }

  const lookup = {};

  REGION_META.forEach((meta, index) => {
    const value = values[index + 1] ?? 0;

    const codes = Array.isArray(meta.codes) ? meta.codes : [meta.code];

    codes.forEach((code) => {
      lookup[String(code)] = {
        name: meta.name,

        value: Number(value) || 0,
      };
    });
  });

  return {
    lookup,
    total: Number(values[0]) || 0,
  };
}

/* ================================================================
Year Buttons
================================================================ */

function renderYearButtons() {
  if (!els.yearButtons) {
    return;
  }

  els.yearButtons.innerHTML = "";

  const years = Object.keys(CASE_DATA || {});

  years.forEach((year) => {
    const button = document.createElement("button");

    button.type = "button";

    button.className = "choice-button";

    button.dataset.value = year;

    button.textContent = year;

    button.setAttribute("aria-pressed", String(year === selectedYear));

    if (year === selectedYear) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (selectedYear === year) {
        return;
      }

      selectedYear = year;

      const diseases = Object.keys(CASE_DATA[selectedYear] || {});

      if (!diseases.includes(selectedDisease)) {
        selectedDisease = diseases[0] ?? "";
      }

      renderYearButtons();

      renderDiseaseButtons();

      render();
    });

    els.yearButtons.appendChild(button);
  });
}

/* ================================================================
Disease Buttons
================================================================ */

function renderDiseaseButtons() {
  if (!els.diseaseButtons) {
    return;
  }

  els.diseaseButtons.innerHTML = "";

  const diseases = Object.keys(CASE_DATA?.[selectedYear] || {});

  diseases.forEach((disease) => {
    const button = document.createElement("button");

    button.type = "button";

    button.className = "choice-button";

    button.dataset.value = disease;

    button.textContent = disease;

    button.setAttribute("aria-pressed", String(disease === selectedDisease));

    if (disease === selectedDisease) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (selectedDisease === disease) {
        return;
      }

      selectedDisease = disease;

      renderDiseaseButtons();

      render();
    });

    els.diseaseButtons.appendChild(button);
  });
}

/* ================================================================
Render
================================================================ */

async function render() {
  const year = selectedYear;

  const disease = selectedDisease;

  if (!CASE_DATA || !year || !disease) {
    return;
  }

  hideError();

  const needsFetch = !SIDO_MAP;

  if (needsFetch) {
    setLoading(true, "시도 경계 데이터를 가져오는 중…");
  }

  let fc;

  try {
    fc = await loadSidoMap();
  } catch (err) {
    console.error(err);

    showError(
      `admdongkor 라이브러리에서 시도 경계를 가져오지 못했습니다.\n` +
        `MAP_VERSION: ${MAP_VERSION}\n` +
        `네트워크/CORS 문제이거나 해당 버전의 지도 데이터가 존재하지 않을 수 있습니다.\n` +
        `(${err.message || err})`,
    );

    return;
  }

  setLoading(false);

  const { lookup, total } = buildValueByCode(year, disease);

  const { group, meshes, outlines, materials, maxValue, bestCentroid } =
    buildTerrain(fc, lookup);

  disposeGroup(regionGroup);

  scene.remove(regionGroup);

  regionGroup = group;

  scene.add(regionGroup);

  interactiveMeshes = meshes;
  startTerrainAnimation(meshes);

  outlinesByCode = outlines;

  materialsByCode = materials;

  hoveredCode = null;
  selectedCode = null;

  rebuildLabels(bestCentroid);

  els.totalName.textContent = "전국 합계";
  els.total.textContent = total.toLocaleString("ko-KR");

  els.legendMax.textContent = maxValue.toLocaleString("ko-KR");

  updateDiseaseDescription(disease);
}

/* ================================================================
Hover
================================================================ */

const raycaster = new THREE.Raycaster();

const pointer = new THREE.Vector2();

function setHover(code) {
  if (code === hoveredCode) {
    return;
  }

  // 이전 hover 제거
  if (hoveredCode && outlinesByCode[hoveredCode]) {
    outlinesByCode[hoveredCode].forEach((outline) => {
      /*
       * 선택된 지역이면 hover 제거하지 않음
       */
      if (hoveredCode === selectedCode) {
        return;
      }

      outline.visible = false;

      outline.material.color.setHex(HIGHLIGHT_COLOR);
      outline.material.opacity = HOVER_OUTLINE_OPACITY;
    });

    if (hoveredCode !== selectedCode && materialsByCode[hoveredCode]) {
      materialsByCode[hoveredCode].emissive.setHex(0x000000);
    }
  }

  hoveredCode = code;

  // 새 hover
  if (hoveredCode && outlinesByCode[hoveredCode]) {
    outlinesByCode[hoveredCode].forEach((outline) => {
      /*
       * 이미 선택된 지역이면
       * 선택 스타일을 그대로 유지
       */
      if (hoveredCode === selectedCode) {
        return;
      }

      outline.visible = true;
      outline.material.color.setHex(HIGHLIGHT_COLOR);
      outline.material.opacity = HOVER_OUTLINE_OPACITY;
    });

    if (hoveredCode !== selectedCode && materialsByCode[hoveredCode]) {
      materialsByCode[hoveredCode].emissive.setHex(0x2a1c08);
    }
  }
}

function setSelected(code) {
  // 이전 선택 제거
  if (selectedCode && outlinesByCode[selectedCode]) {
    outlinesByCode[selectedCode].forEach((outline) => {
      outline.visible = false;

      outline.material.color.setHex(HIGHLIGHT_COLOR);
      outline.material.opacity = HOVER_OUTLINE_OPACITY;
    });

    if (materialsByCode[selectedCode]) {
      materialsByCode[selectedCode].emissive.setHex(0x000000);
    }
  }

  selectedCode = code;

  // 새로운 선택 적용
  if (selectedCode && outlinesByCode[selectedCode]) {
    outlinesByCode[selectedCode].forEach((outline) => {
      outline.visible = true;

      outline.material.color.setHex(SELECTED_COLOR);
      outline.material.opacity = 1.0;
    });

    if (materialsByCode[selectedCode]) {
      materialsByCode[selectedCode].emissive.setHex(0x5a2608);
    }
  }

  // ★ 전국 합계 / 지역 발생 수 변경
  updateSelectedSummary();
}

function updateSelectedSummary() {
  // 선택된 지역이 없으면 전국 합계로 복원
  if (!selectedCode) {
    els.totalName.textContent = "전국 합계";

    const total = buildValueByCode(selectedYear, selectedDisease).total;

    els.total.textContent = total.toLocaleString("ko-KR");

    return;
  }

  // 선택된 지역 데이터 찾기
  const { lookup } = buildValueByCode(selectedYear, selectedDisease);

  const selected = lookup[selectedCode];

  if (!selected) {
    els.totalName.textContent = "전국 합계";
    els.total.textContent = 0;
    return;
  }

  // 지명
  els.totalName.textContent = selected.name;

  // 발생 수
  els.total.textContent = selected.value.toLocaleString("ko-KR");
}

function handleHover(event) {
  const rect = renderer.domElement.getBoundingClientRect();

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;

  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObjects(interactiveMeshes, false)[0];

  if (hit) {
    const code = hit.object.userData.code;

    setHover(code);

    /*
     * 툴팁은 기존 hover에서만 표시
     *
     * 클릭 선택은 툴팁과 무관함
     */
    els.tooltip.classList.remove("hidden");

    els.tooltip.style.left = `${event.clientX}px`;
    els.tooltip.style.top = `${event.clientY}px`;

    els.tooltipName.textContent = hit.object.userData.name;

    els.tooltipValue.textContent = `${hit.object.userData.value.toLocaleString("ko-KR")}건`;
  } else {
    setHover(null);

    els.tooltip.classList.add("hidden");
  }
}

function handleClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;

  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObjects(interactiveMeshes, false)[0];

  // 빈 공간 클릭 → 선택 취소
  if (!hit) {
    setSelected(null);
    return;
  }

  const code = hit.object.userData.code;

  // 같은 지역 다시 클릭 → 선택 취소
  if (selectedCode === code) {
    setSelected(null);
    return;
  }

  // 새로운 지역 선택
  setSelected(code);
}

renderer.domElement.addEventListener("pointerleave", () => {
  setHover(null);

  els.tooltip.classList.add("hidden");
});

/* ================================================================
Init
================================================================ */

async function init() {
  setupCameraControls();

  onResize();

  try {
    CASE_DATA = await loadCaseData();
  } catch (err) {
    showError(`data.json을 불러오지 못했습니다.\n(${err.message || err})`);

    return;
  }

  const years = Object.keys(CASE_DATA || {});

  if (!years.length) {
    showError("data.json에 연도 데이터가 없습니다.");

    return;
  }

  selectedYear = years.includes("2021") ? "2021" : years[0];

  const diseases = Object.keys(CASE_DATA[selectedYear] || {});

  selectedDisease = diseases[0] ?? "";

  renderYearButtons();

  renderDiseaseButtons();

  updateDiseaseDescription(selectedDisease);

  render();
}

init();
