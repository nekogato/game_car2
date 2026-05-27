    import * as THREE from 'three';
    import * as CANNON from 'cannon-es';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { CONFIG, STORAGE_KEY, PIECES, DIRS } from './config.js';
    import { createPixelPipeline } from './pixel-postprocess.js';

    const state = {
      mode: 'edit',
      tool: 'straight',
      rotation: 1,
      erase: false,
      selectedKey: null,
      pieces: new Map(),
      carPath: [],
      trackLoops: false,
      carCount: 1,
      laneCount: CONFIG.defaultLaneCount,
      carSpeed: 0,
      carPressure: 0,
      carStopped: false,
      lastSlope: 0,
      messageTimer: 0,
      selectedCarIndex: null,
    };

    const canvas = document.querySelector('#game');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.sky);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(9, 11, 13);

    const { composer, updatePixelShader } = createPixelPipeline(renderer, scene, camera, canvas);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 8;
    controls.maxDistance = 28;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const mouse = {
      down: false,
      moved: false,
      placeCandidate: false,
      startX: 0,
      startY: 0,
    };

    const trackGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    const worldGroup = new THREE.Group();
    scene.add(worldGroup, trackGroup, previewGroup);

    const modeText = document.querySelector('#modeText');
    const pieceText = document.querySelector('#pieceText');
    const countText = document.querySelector('#countText');
    const carCountText = document.querySelector('#carCountText');
    const laneCountText = document.querySelector('#laneCountText');
    const toast = document.querySelector('#toast');
    const pieceActions = document.querySelector('#pieceActions');
    const pieceRotateBtn = document.querySelector('#pieceRotateBtn');
    const pieceDeleteBtn = document.querySelector('#pieceDeleteBtn');
    const controlHelpWindow = document.querySelector('#controlHelpWindow');
    const closeControlHelpBtn = document.querySelector('#closeControlHelpBtn');
    const startControlHelpBtn = document.querySelector('#startControlHelpBtn');
    const carWindow = document.querySelector('#carWindow');
    const carWindowTitle = document.querySelector('#carWindowTitle');
    const closeCarWindowBtn = document.querySelector('#closeCarWindowBtn');
    const launchCarBtn = document.querySelector('#launchCarBtn');
    const carColorInput = document.querySelector('#carColorInput');
    const carStartSpeedInput = document.querySelector('#carStartSpeedInput');
    const carMotorInput = document.querySelector('#carMotorInput');
    const carMaxSpeedInput = document.querySelector('#carMaxSpeedInput');
    const carInfoWindow = document.querySelector('#carInfoWindow');
    const carInfoWindowTitle = document.querySelector('#carInfoWindowTitle');
    const closeCarInfoWindowBtn = document.querySelector('#closeCarInfoWindowBtn');
    const carInfoTitleText = document.querySelector('#carInfoTitleText');
    const carInfoName = document.querySelector('#carInfoName');
    const carInfoStatus = document.querySelector('#carInfoStatus');
    const carInfoSpeed = document.querySelector('#carInfoSpeed');
    const carInfoColorChip = document.querySelector('#carInfoColorChip');
    const carInfoColor = document.querySelector('#carInfoColor');
    const carInfoLane = document.querySelector('#carInfoLane');
    const carInfoDerailRisk = document.querySelector('#carInfoDerailRisk');
    const carInfoStability = document.querySelector('#carInfoStability');
    const carInfoMotor = document.querySelector('#carInfoMotor');
    const carWindowDrag = {
      active: false,
      offsetX: 0,
      offsetY: 0,
    };
    const carInfoWindowDrag = {
      active: false,
      offsetX: 0,
      offsetY: 0,
    };

    const physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, 0, 0),
    });
    physicsWorld.allowSleep = false;
    const carActors = [];

    setupWorld();
    setCarCount(CONFIG.defaultCarCount);
    bindUi();
    loadSavedTrack();
    redrawTrack();
    updatePreview();
    updateHud();

    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      resize();
      controls.update();
      updateCar(dt);
      updatePixelShader();
      updateSelectedOverlay();
      updateCarInfoWindow();
      composer.render();
    });

    function setupWorld() {
      const size = CONFIG.gridSize * CONFIG.tile;
      const floor = createCheckerFloor(size + 2, CONFIG.gridSize + 1);
      floor.position.y = -0.1;
      worldGroup.add(floor);

      const table = new THREE.Mesh(
        new THREE.BoxGeometry(size + 4, 0.7, size + 4),
        new THREE.MeshBasicMaterial({ color: CONFIG.colors.table })
      );
      table.position.y = -0.55;
      worldGroup.add(table);
    }

    function createCheckerFloor(size, cells) {
      const geometry = new THREE.BoxGeometry(size, 0.16, size);
      if (CONFIG.colors.floor === CONFIG.colors.floorAlt) {
        return new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({ color: CONFIG.colors.floor })
        );
      }
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const block = canvas.width / 8;
      ctx.fillStyle = `#${CONFIG.colors.floor.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `#${CONFIG.colors.floorAlt.toString(16).padStart(6, '0')}`;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          if ((x + y) % 2 === 0) ctx.fillRect(x * block, y * block, block, block);
        }
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(cells / 2, cells / 2);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
      });
      return new THREE.Mesh(geometry, material);
    }

    function bindUi() {
      document.querySelectorAll('[data-tool]').forEach((button) => {
        button.addEventListener('click', () => {
          state.tool = button.dataset.tool;
          state.erase = false;
          state.selectedKey = null;
          setMode('edit');
          document.querySelectorAll('[data-tool]').forEach((btn) => btn.classList.toggle('active', btn === button));
          document.querySelector('#eraseBtn').classList.remove('active');
          redrawTrack();
          updatePreview();
          updateHud();
          updateSelectedOverlay();
        });
      });

      document.querySelector('#rotateBtn').addEventListener('click', () => {
        rotateSelectionOrTool();
        updatePreview();
        updateSelectedOverlay();
      });

      document.querySelector('#eraseBtn').addEventListener('click', () => {
        state.erase = !state.erase;
        if (state.erase) state.selectedKey = null;
        setMode('edit');
        document.querySelector('#eraseBtn').classList.toggle('active', state.erase);
        redrawTrack();
        updatePreview();
        updateHud();
        updateSelectedOverlay();
      });

      pieceRotateBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        rotateSelectionOrTool();
        updatePreview();
        updateSelectedOverlay();
      });

      pieceDeleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteSelectedPiece();
      });

      closeControlHelpBtn.addEventListener('click', closeControlHelp);
      startControlHelpBtn.addEventListener('click', closeControlHelp);

      document.querySelector('#playBtn').addEventListener('click', () => {
        if (state.mode === 'drive') {
          setMode('edit');
          return;
        }
        startDrive();
      });

      document.querySelector('#lessCarsBtn').addEventListener('click', () => {
        setCarCount(state.carCount - 1);
        updateHud();
      });

      document.querySelector('#moreCarsBtn').addEventListener('click', () => {
        openCarWindow();
      });

      closeCarWindowBtn.addEventListener('click', () => closeCarWindow());
      launchCarBtn.addEventListener('click', () => launchConfiguredCar());
      carWindowTitle.addEventListener('pointerdown', startCarWindowDrag);
      closeCarInfoWindowBtn.addEventListener('click', () => closeCarInfoWindow());
      carInfoWindowTitle.addEventListener('pointerdown', startCarInfoWindowDrag);
      window.addEventListener('pointermove', dragCarWindow);
      window.addEventListener('pointermove', dragCarInfoWindow);
      window.addEventListener('pointerup', stopCarWindowDrag);
      window.addEventListener('pointerup', stopCarInfoWindowDrag);

      document.querySelector('#lessLanesBtn').addEventListener('click', () => {
        setLaneCount(state.laneCount - 1);
      });

      document.querySelector('#moreLanesBtn').addEventListener('click', () => {
        setLaneCount(state.laneCount + 1);
      });

      document.querySelector('#clearBtn').addEventListener('click', () => {
        state.pieces.clear();
        state.selectedKey = null;
        saveTrack();
        redrawTrack();
        setMode('edit');
        updateHud();
        updateSelectedOverlay();
        showToast('清空完成');
      });

      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerdown', (event) => {
        setPointerFromEvent(event);
        renderer.domElement.setPointerCapture(event.pointerId);
        mouse.down = true;
        mouse.moved = false;
        mouse.placeCandidate = event.button === 0 && state.mode === 'edit';
        mouse.startX = event.clientX;
        mouse.startY = event.clientY;
      });
      renderer.domElement.addEventListener('pointerup', (event) => {
        setPointerFromEvent(event);
        const dx = event.clientX - mouse.startX;
        const dy = event.clientY - mouse.startY;
        const isClick = Math.hypot(dx, dy) < 6;
        if (isClick && openCarInfoAtPointer()) {
          mouse.placeCandidate = false;
        } else if (mouse.placeCandidate && isClick && state.mode === 'edit') {
          placeAtPointer();
        }
        mouse.down = false;
        mouse.placeCandidate = false;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }
      });
      renderer.domElement.addEventListener('pointercancel', (event) => {
        mouse.down = false;
        mouse.placeCandidate = false;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }
      });
      window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'r') {
          rotateSelectionOrTool();
          updatePreview();
        }
        if (event.key === 'Escape') setMode('edit');
        if (event.key === ' ') {
          event.preventDefault();
          state.mode === 'drive' ? setMode('edit') : startDrive();
        }
      });
    }

    function setMode(mode) {
      state.mode = mode;
      carActors.forEach((actor) => {
        actor.mesh.visible = mode === 'drive';
      });
      previewGroup.visible = mode === 'edit';
      document.querySelector('#playBtn').textContent = mode === 'drive' ? '編輯' : '試跑';
      updateHud();
    }

    function closeControlHelp() {
      controlHelpWindow?.classList.remove('show');
    }

    function setCarCount(count) {
      const nextCount = THREE.MathUtils.clamp(count, 1, CONFIG.maxCarCount);
      state.carCount = nextCount;
      while (carActors.length < nextCount) {
        carActors.push(createCarActor(carActors.length));
      }
      while (carActors.length > nextCount) {
        const actor = carActors.pop();
        scene.remove(actor.mesh);
        physicsWorld.removeBody(actor.body);
      }
      if (state.selectedCarIndex !== null && state.selectedCarIndex >= carActors.length) {
        closeCarInfoWindow();
      }
      carActors.forEach((actor) => {
        actor.mesh.visible = state.mode === 'drive';
      });
      if (state.mode === 'drive') setMode('edit');
    }

    function addConfiguredCar(options = {}) {
      if (carActors.length >= CONFIG.maxCarCount) {
        showToast('車庫已滿');
        return null;
      }
      const actor = createCarActor(carActors.length, options);
      carActors.push(actor);
      state.carCount = carActors.length;
      updateHud();
      return actor;
    }

    function setLaneCount(count) {
      state.laneCount = THREE.MathUtils.clamp(count, 1, CONFIG.maxLaneCount);
      carActors.forEach((actor, index) => {
        actor.laneIndex = index % state.laneCount;
      });
      redrawTrack();
      saveTrack();
      updatePreview();
      updateHud();
      if (state.mode === 'drive') setMode('edit');
    }

    function openCarWindow() {
      if (!carWindow) return;
      if (carActors.length >= CONFIG.maxCarCount) {
        showToast('車庫已滿');
        return;
      }
      carWindow.classList.add('show');
    }

    function closeCarWindow() {
      carWindow?.classList.remove('show');
      carWindowDrag.active = false;
    }

    function startCarWindowDrag(event) {
      if (event.target.closest('button')) return;
      const rect = carWindow.getBoundingClientRect();
      carWindowDrag.active = true;
      carWindowDrag.offsetX = event.clientX - rect.left;
      carWindowDrag.offsetY = event.clientY - rect.top;
      carWindow.setPointerCapture?.(event.pointerId);
    }

    function dragCarWindow(event) {
      if (!carWindowDrag.active) return;
      carWindow.style.left = `${event.clientX - carWindowDrag.offsetX}px`;
      carWindow.style.top = `${event.clientY - carWindowDrag.offsetY}px`;
      carWindow.style.transform = 'none';
    }

    function stopCarWindowDrag() {
      carWindowDrag.active = false;
    }

    function closeCarInfoWindow() {
      carInfoWindow?.classList.remove('show');
      carInfoWindowDrag.active = false;
      state.selectedCarIndex = null;
    }

    function startCarInfoWindowDrag(event) {
      if (event.target.closest('button')) return;
      const rect = carInfoWindow.getBoundingClientRect();
      carInfoWindowDrag.active = true;
      carInfoWindowDrag.offsetX = event.clientX - rect.left;
      carInfoWindowDrag.offsetY = event.clientY - rect.top;
      carInfoWindow.setPointerCapture?.(event.pointerId);
    }

    function dragCarInfoWindow(event) {
      if (!carInfoWindowDrag.active) return;
      carInfoWindow.style.left = `${event.clientX - carInfoWindowDrag.offsetX}px`;
      carInfoWindow.style.top = `${event.clientY - carInfoWindowDrag.offsetY}px`;
      carInfoWindow.style.transform = 'none';
    }

    function stopCarInfoWindowDrag() {
      carInfoWindowDrag.active = false;
    }

    function launchConfiguredCar() {
      const actor = addConfiguredCar({
        color: Number.parseInt(carColorInput.value.slice(1), 16),
        startSpeed: Number(carStartSpeedInput.value),
        motorAccel: Number(carMotorInput.value),
        maxSpeed: Number(carMaxSpeedInput.value),
      });
      if (!actor) return;
      closeCarWindow();
      if (state.mode === 'drive' && state.carPath.length > 2) {
        launchActorOnCurrentTrack(actor, carActors.length - 1);
        showToast('新車出發');
        return;
      }
      const path = buildDrivePath();
      if (path.length >= 3) {
        startDrive();
      } else {
        showToast('已加入車庫');
      }
    }

    function createCarActor(index, options = {}) {
      const mesh = createCar(index, options);
      const color = options.color ?? CONFIG.colors.cars[index % CONFIG.colors.cars.length];
      const params = {
        startSpeed: options.startSpeed ?? CONFIG.physics.startSpeed,
        motorAccel: options.motorAccel ?? CONFIG.physics.motorAccel,
        maxSpeed: options.maxSpeed ?? CONFIG.physics.maxSpeed,
      };
      mesh.visible = false;
      scene.add(mesh);
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Sphere(CONFIG.physics.carRadius),
        position: new CANNON.Vec3(0, 0, 0),
        linearDamping: 0.16,
        angularDamping: 0.85,
      });
      body.collisionResponse = true;
      physicsWorld.addBody(body);
      const actor = {
        index,
        name: options.name ?? `四驅車 ${index + 1}`,
        color,
        mesh,
        body,
        targetIndex: 1,
        speed: 0,
        pressure: 0,
        stopped: false,
        finished: false,
        laneIndex: index % state.laneCount,
        lanePath: [],
        lowSpeedTime: 0,
        derailed: false,
        derailState: 'none',
        flightVelocity: new THREE.Vector3(),
        spinVelocity: new THREE.Vector3(),
        flightTime: 0,
        derailedFromRaisedCrossover: false,
        derailHitCount: 0,
        derailHitCooldown: 0,
        flipTimer: 0,
        flipYaw: 0,
        params,
      };
      actor.mesh.traverse((child) => {
        child.userData.carActorIndex = actor.index;
      });
      return actor;
    }

    function rotateSelectionOrTool() {
      if (state.tool === 'select' && state.selectedKey && state.pieces.has(state.selectedKey)) {
        const piece = state.pieces.get(state.selectedKey);
        piece.rotation = (piece.rotation + 1) % 4;
        state.rotation = piece.rotation;
        redrawTrack();
        saveTrack();
        updateHud();
        updateSelectedOverlay();
        return;
      }
      state.rotation = (state.rotation + 1) % 4;
      updatePreview();
    }

    function deleteSelectedPiece() {
      if (!state.selectedKey || !state.pieces.has(state.selectedKey)) return;
      state.pieces.delete(state.selectedKey);
      state.selectedKey = null;
      redrawTrack();
      saveTrack();
      updatePreview();
      updateHud();
      updateSelectedOverlay();
    }

    function onPointerMove(event) {
      setPointerFromEvent(event);
      if (mouse.down && Math.hypot(event.clientX - mouse.startX, event.clientY - mouse.startY) >= 6) {
        mouse.moved = true;
      }
      updatePreview();
    }

    function setPointerFromEvent(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function openCarInfoAtPointer() {
      const actor = pickCarActorAtPointer();
      if (!actor) return false;
      openCarInfoWindow(actor);
      return true;
    }

    function pickCarActorAtPointer() {
      const visibleCars = carActors.filter((actor) => actor.mesh.visible);
      if (visibleCars.length === 0) return null;
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects(visibleCars.map((actor) => actor.mesh), true);
      if (intersections.length === 0) return null;
      let object = intersections[0].object;
      while (object && object.userData.carActorIndex === undefined) object = object.parent;
      if (!object) return null;
      return carActors[object.userData.carActorIndex] ?? null;
    }

    function openCarInfoWindow(actor) {
      if (!carInfoWindow) return;
      state.selectedCarIndex = actor.index;
      carInfoWindow.classList.add('show');
      updateCarInfoWindow();
    }

    function placeAtPointer() {
      const cell = pointerToCell();
      if (!cell) return;
      const { x, z } = cell;
      const key = cellKey(x, z);
      if (state.tool === 'select') {
        const hitPiece = findPieceAtCell(x, z);
        state.selectedKey = hitPiece ? cellKey(hitPiece.x, hitPiece.z) : null;
        if (hitPiece) state.rotation = hitPiece.rotation;
        redrawTrack();
        updatePreview();
        updateHud();
        updateSelectedOverlay();
        return;
      }
      if (state.erase) {
        const hitPiece = findPieceAtCell(x, z);
        if (hitPiece) {
          const hitKey = cellKey(hitPiece.x, hitPiece.z);
          state.pieces.delete(hitKey);
          if (state.selectedKey === hitKey) state.selectedKey = null;
        }
      } else {
        if (Math.abs(x) > Math.floor(CONFIG.gridSize / 2) || Math.abs(z) > Math.floor(CONFIG.gridSize / 2)) return;
        const hitPiece = findPieceAtCell(x, z);
        if (hitPiece) {
          showToast('這裡已有賽道');
          return;
        }
        if (state.tool === 'start') {
          [...state.pieces.entries()].forEach(([pieceKey, piece]) => {
            if (piece.type === 'start') state.pieces.delete(pieceKey);
          });
        }
        if (!canPlacePiece({ x, z, type: state.tool, rotation: state.rotation })) {
          showToast('位置已被其他賽道佔用');
          return;
        }
        state.pieces.set(key, { x, z, type: state.tool, rotation: state.rotation });
        state.selectedKey = null;
      }
      redrawTrack();
      saveTrack();
      updateHud();
      updateSelectedOverlay();
    }

    function saveTrack() {
      const pieces = [...state.pieces.values()].map(({ x, z, type, rotation }) => ({ x, z, type, rotation }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pieces, laneCount: state.laneCount }));
    }

    function loadSavedTrack() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!Array.isArray(data?.pieces)) return;
        if (Number.isInteger(data.laneCount)) {
          state.laneCount = THREE.MathUtils.clamp(data.laneCount, 1, CONFIG.maxLaneCount);
        }
        state.pieces.clear();
        data.pieces.forEach((piece) => {
          if (!PIECES[piece.type]) return;
          if (!Number.isInteger(piece.x) || !Number.isInteger(piece.z)) return;
          const rotation = Number.isInteger(piece.rotation) ? ((piece.rotation % 4) + 4) % 4 : 0;
          const loadedPiece = {
            x: piece.x,
            z: piece.z,
            type: piece.type,
            rotation,
          };
          if (canPlacePiece(loadedPiece)) {
            state.pieces.set(cellKey(piece.x, piece.z), loadedPiece);
          }
        });
        if (state.pieces.size > 0) showToast('已載入上次編輯的賽道');
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    function getTrackWidth() {
      return getLaneWidth() * state.laneCount;
    }

    function getLaneWidth() {
      const maxWidthForCurve = CONFIG.tile - CONFIG.railWidth * 2 - 0.18;
      return Math.min(CONFIG.laneWidth, maxWidthForCurve / state.laneCount);
    }

    function getLaneOffset(laneIndex) {
      return getLaneOffsetForFloat(laneIndex);
    }

    function getLaneOffsetForFloat(laneFloat) {
      return (laneFloat - (state.laneCount - 1) * 0.5) * getLaneWidth();
    }

    function getPieceCellLength(type) {
      return type === 'crossover' ? 2 : 1;
    }

    function getPieceWorldLength(type) {
      return CONFIG.tile * getPieceCellLength(type);
    }

    function getPieceLocalCenterZ(type) {
      return -CONFIG.tile * (getPieceCellLength(type) - 1) * 0.5;
    }

    function getPieceFootprint(piece) {
      const dir = DIRS[piece.rotation];
      const cells = [];
      for (let i = 0; i < getPieceCellLength(piece.type); i += 1) {
        cells.push({ x: piece.x + dir.x * i, z: piece.z + dir.y * i });
      }
      return cells;
    }

    function findPieceAtCell(x, z) {
      for (const piece of state.pieces.values()) {
        if (getPieceFootprint(piece).some((cell) => cell.x === x && cell.z === z)) return piece;
      }
      return null;
    }

    function canPlacePiece(piece) {
      const limit = Math.floor(CONFIG.gridSize / 2);
      return getPieceFootprint(piece).every((cell) => {
        if (Math.abs(cell.x) > limit || Math.abs(cell.z) > limit) return false;
        const occupant = findPieceAtCell(cell.x, cell.z);
        return !occupant || cellKey(occupant.x, occupant.z) === cellKey(piece.x, piece.z);
      });
    }

    function pointerToCell() {
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      const x = Math.round(hit.x / CONFIG.tile);
      const z = Math.round(hit.z / CONFIG.tile);
      return { x, z };
    }

    function updatePreview() {
      previewGroup.clear();
      const cell = pointerToCell();
      if (!cell || state.mode !== 'edit') return;
      if (state.tool === 'select') return;
      const key = cellKey(cell.x, cell.z);
      const piece = state.erase
        ? makeEraseMarker()
        : createTrackPiece({ type: state.tool, rotation: state.rotation }, true);
      piece.position.set(cell.x * CONFIG.tile, 0.07, cell.z * CONFIG.tile);
      if (!state.erase && !canPlacePiece({ x: cell.x, z: cell.z, type: state.tool, rotation: state.rotation })) {
        tintGroup(piece, CONFIG.colors.previewBad, 0.5);
      }
      previewGroup.add(piece);
    }

    function redrawTrack() {
      trackGroup.clear();
      state.pieces.forEach((piece) => {
        const selected = cellKey(piece.x, piece.z) === state.selectedKey;
        const mesh = createTrackPiece(piece, false, selected);
        mesh.position.set(piece.x * CONFIG.tile, 0, piece.z * CONFIG.tile);
        trackGroup.add(mesh);
      });
    }

    function createTrackPiece(piece, preview = false, selected = false) {
      const group = new THREE.Group();
      const color = selected ? CONFIG.colors.selected : preview ? CONFIG.colors.previewOk : PIECES[piece.type].color;
      const trackWidth = getTrackWidth();
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: preview,
        opacity: preview ? 0.55 : 1,
        side: THREE.DoubleSide,
      });
      const railMat = new THREE.MeshBasicMaterial({
        color: CONFIG.colors.rail,
        transparent: preview,
        opacity: preview ? 0.55 : 1,
        side: THREE.DoubleSide,
      });

      if (piece.type === 'curveL' || piece.type === 'curveR') {
        const geometry = createCurveGeometry(piece.type);
        const deck = new THREE.Mesh(geometry, mat);
        group.add(deck);

        for (const side of [-1, 1]) {
          const rail = createOutlinedRail(createCurveRailGeometry(piece.type, side), railMat);
          group.add(rail);
        }
        for (let lane = 1; lane < state.laneCount; lane += 1) {
          const marker = createOutlinedRail(createCurveLaneMarkerGeometry(piece.type, lane), railMat);
          group.add(marker);
        }
      } else {
        const pieceLength = getPieceWorldLength(piece.type);
        const pieceCenterZ = getPieceLocalCenterZ(piece.type);
        const deck = new THREE.Mesh(
          new THREE.BoxGeometry(trackWidth, CONFIG.trackHeight, pieceLength),
          mat
        );
        deck.position.y = CONFIG.trackHeight * 0.5;
        deck.position.z = pieceCenterZ;
        group.add(deck);

        if (isLaneTransitionPiece(piece.type)) {
          group.add(createLaneTransitionRails(piece.type, deck.position.y, railMat, mat));
        } else {
          for (const side of [-1, 1]) {
          const rail = createOutlinedRail(
            new THREE.BoxGeometry(CONFIG.railWidth, CONFIG.railHeight, pieceLength),
            railMat
          );
          rail.position.set(
            side * trackWidth * 0.5,
            deck.position.y + CONFIG.railBaseOffset,
            pieceCenterZ
          );
            group.add(rail);
          }
          for (let lane = 1; lane < state.laneCount; lane += 1) {
            group.add(createStraightDivider(lane, deck.position.y, railMat));
          }
        }
      }

      if (piece.type === 'start') {
        const gateMat = new THREE.MeshBasicMaterial({ color: CONFIG.colors.accent });
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 0.12), gateMat);
          post.position.set(side * (trackWidth * 0.5 + 0.28), 0.68, -0.35);
          group.add(post);
        }
        const topBar = new THREE.Mesh(new THREE.BoxGeometry(trackWidth + 0.78, 0.12, 0.12), gateMat);
        topBar.position.set(0, 1.25, -0.35);
        group.add(topBar);
      }

      group.rotation.y = -piece.rotation * Math.PI * 0.5;
      return group;
    }

    function createStraightDivider(lane, deckY, railMat) {
      const trackWidth = getTrackWidth();
      const divider = createOutlinedRail(
        new THREE.BoxGeometry(CONFIG.railWidth, CONFIG.railHeight, CONFIG.tile),
        railMat
      );
      divider.position.set(
        -trackWidth * 0.5 + lane * getLaneWidth(),
        deckY + CONFIG.railBaseOffset,
        0
      );
      return divider;
    }

    function createOutlinedRail(geometry, material) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(geometry, material);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({ color: CONFIG.colors.railEdge })
      );
      group.add(mesh, edges);
      return group;
    }

    function isLaneTransitionPiece(type) {
      return type === 'crossover' || type === 'wave';
    }

    function createLaneTransitionRails(type, deckY, railMat, deckMat) {
      const group = new THREE.Group();
      const railY = deckY + CONFIG.railBaseOffset;
      const routeMat = new THREE.MeshBasicMaterial({
        color: type === 'crossover' ? CONFIG.colors.crossover : CONFIG.colors.track,
      });

      for (let lane = 0; lane < state.laneCount; lane += 1) {
        const center = createLaneLocalPath(type, lane, 36, 0);
        const strip = createPathSegments(
          center,
          deckY + CONFIG.trackHeight * 0.5 + 0.012,
          routeMat,
          {
            width: getTransitionLaneSurfaceWidth(type),
            height: 0.018,
            yOffset: (t) => getLaneVerticalOffset(type, lane, getLaneEndForPiece(type, lane), t),
          }
        );
        group.add(strip);

        if (type !== 'crossover' || state.laneCount < 3) {
          for (const side of [-0.5, 0.5]) {
            const sidePath = createLaneLocalPath(type, lane, 36, side);
            group.add(createPathSegments(
              sidePath,
              railY,
              railMat,
              {
                width: CONFIG.railWidth,
                height: CONFIG.railHeight,
                outline: true,
                yOffset: (t) => getLaneVerticalOffset(type, lane, getLaneEndForPiece(type, lane), t),
              }
            ));
          }
        }
      }

      if (type === 'crossover' && state.laneCount >= 3) {
        createCrossoverRailSpecs().forEach((spec) => {
          group.add(createPathSegments(
            createCrossoverRailPath(spec),
            railY,
            railMat,
            {
              width: CONFIG.railWidth,
              height: CONFIG.railHeight,
              outline: true,
              yOffset: spec.raised ? (t) => Math.sin(Math.PI * t) * 0.58 : undefined,
            }
          ));
        });
        const shadow = new THREE.Mesh(
          new THREE.BoxGeometry(getLaneWidth() * 1.15, 0.035, CONFIG.tile * 0.42),
          deckMat
        );
        shadow.position.set(getLaneOffsetForFloat(1), deckY + CONFIG.trackHeight * 0.5 + 0.025, getPieceLocalCenterZ(type));
        group.add(shadow);
      }

      return group;
    }

    function getTransitionLaneSurfaceWidth(type) {
      if (state.laneCount <= 1) return getLaneWidth() * 0.72;
      if (type === 'crossover') return Math.max(0.18, getLaneWidth() - CONFIG.railWidth * 0.95);
      return Math.max(0.18, getLaneWidth() - CONFIG.railWidth * 1.25);
    }

    function createCrossoverRailSpecs() {
      return [
        { start: -0.5, end: state.laneCount - 1.5, raised: true, wave: -0.26 },
        { start: 0.5, end: state.laneCount - 0.5, raised: true, wave: -0.26 },
        { start: 0.5, end: -0.5, raised: false, wave: 0.22 },
        { start: 1.5, end: 0.5, raised: false, wave: 0.24 },
        { start: 2.5, end: 1.5, raised: false, wave: 0.22 },
      ];
    }

    function createCrossoverRailPath(spec, segments = 48) {
      const length = getPieceWorldLength('crossover');
      const points = [];
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const eased = t * t * (3 - 2 * t);
        const wave = Math.sin(Math.PI * 2 * t) * spec.wave;
        points.push({
          x: getLaneOffsetForFloat(THREE.MathUtils.lerp(spec.start, spec.end, eased) + wave),
          z: CONFIG.tile * 0.5 - length * t,
          t,
        });
      }
      return points;
    }

    function createLaneLocalPath(type, lane, segments, sideFloat = 0) {
      const laneEnd = getLaneEndForPiece(type, lane);
      const length = getPieceWorldLength(type);
      const points = [];
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const laneFloat = getLaneFloatForPiece(type, lane, laneEnd, t) + sideFloat;
        points.push({
          x: getLaneOffsetForFloat(laneFloat),
          z: CONFIG.tile * 0.5 - length * t,
          t,
        });
      }
      return points;
    }

    function createPathSegments(points, baseY, material, options = {}) {
      const width = options.width ?? CONFIG.railWidth;
      const height = options.height ?? CONFIG.railHeight;
      const yOffset = options.yOffset ?? (() => 0);
      const omit = options.omit ?? (() => false);
      const visibleChunks = [];
      let chunk = [];
      points.forEach((point) => {
        if (omit(point.t)) {
          if (chunk.length > 1) visibleChunks.push(chunk);
          chunk = [];
          return;
        }
        chunk.push(point);
      });
      if (chunk.length > 1) visibleChunks.push(chunk);
      if (visibleChunks.length !== 1 || visibleChunks[0].length !== points.length) {
        const group = new THREE.Group();
        visibleChunks.forEach((visiblePoints) => {
          const geometry = createPathRibbonGeometry(visiblePoints, width, height, baseY, yOffset);
          group.add(options.outline ? createOutlinedRail(geometry, material) : new THREE.Mesh(geometry, material));
        });
        group.traverse((child) => {
          if (child.isMesh) {
          }
        });
        return group;
      }
      const geometry = createPathRibbonGeometry(points, width, height, baseY, yOffset);
      return options.outline ? createOutlinedRail(geometry, material) : new THREE.Mesh(geometry, material);
    }

    function createPathRibbonGeometry(points, width, height, baseY, yOffset) {
      const vertices = [];
      const indices = [];
      const halfWidth = width * 0.5;
      const halfHeight = height * 0.5;

      points.forEach((point, index) => {
        const prev = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        let dx = next.x - prev.x;
        let dz = next.z - prev.z;
        const length = Math.hypot(dx, dz) || 1;
        dx /= length;
        dz /= length;
        const nx = dz;
        const nz = -dx;
        const y = baseY + yOffset(point.t);
        const leftX = point.x - nx * halfWidth;
        const leftZ = point.z - nz * halfWidth;
        const rightX = point.x + nx * halfWidth;
        const rightZ = point.z + nz * halfWidth;
        vertices.push(
          leftX, y + halfHeight, leftZ,
          rightX, y + halfHeight, rightZ,
          leftX, y - halfHeight, leftZ,
          rightX, y - halfHeight, rightZ
        );
      });

      for (let i = 0; i < points.length - 1; i += 1) {
        const a = i * 4;
        const b = (i + 1) * 4;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
        indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
        indices.push(a, a + 2, b, a + 2, b + 2, b);
        indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
      }

      const first = 0;
      const last = (points.length - 1) * 4;
      indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
      indices.push(last, last + 2, last + 1, last + 1, last + 2, last + 3);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    }

    function createCurveGeometry(type) {
      const radius = CONFIG.tile * 0.5;
      const halfWidth = getTrackWidth() * 0.5;
      return createQuarterRingGeometry(type, radius - halfWidth, radius + halfWidth, CONFIG.trackHeight, 28);
    }

    function createCurveRailGeometry(type, side) {
      const radius = CONFIG.tile * 0.5;
      const halfWidth = getTrackWidth() * 0.5;
      const railRadius = side < 0 ? radius - halfWidth : radius + halfWidth;
      const railBottom = CONFIG.trackHeight * 0.5 + CONFIG.railBaseOffset - CONFIG.railHeight * 0.5;
      return createQuarterRingGeometry(
        type,
        railRadius - CONFIG.railWidth * 0.5,
        railRadius + CONFIG.railWidth * 0.5,
        CONFIG.railHeight,
        28,
        railBottom
      );
    }

    function createCurveLaneMarkerGeometry(type, lane) {
      const laneRadius = CONFIG.tile * 0.5 - getTrackWidth() * 0.5 + lane * getLaneWidth();
      return createQuarterRingGeometry(
        type,
        laneRadius - CONFIG.railWidth * 0.5,
        laneRadius + CONFIG.railWidth * 0.5,
        CONFIG.railHeight,
        28,
        CONFIG.trackHeight * 0.5 + CONFIG.railBaseOffset - CONFIG.railHeight * 0.5
      );
    }

    function createQuarterRingGeometry(type, innerRadius, outerRadius, height, segments, yOffset = 0) {
      const centerX = type === 'curveL' ? -CONFIG.tile * 0.5 : CONFIG.tile * 0.5;
      const centerZ = CONFIG.tile * 0.5;
      const start = type === 'curveL' ? 0 : Math.PI;
      const end = type === 'curveL' ? -Math.PI * 0.5 : Math.PI * 1.5;
      const outer = [];
      const inner = [];

      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const angle = start + (end - start) * t;
        outer.push(new THREE.Vector2(centerX + Math.cos(angle) * outerRadius, centerZ + Math.sin(angle) * outerRadius));
        inner.push(new THREE.Vector2(centerX + Math.cos(angle) * innerRadius, centerZ + Math.sin(angle) * innerRadius));
      }

      const vertices = [];
      const indices = [];
      outer.forEach((point) => vertices.push(point.x, yOffset + height, point.y));
      inner.forEach((point) => vertices.push(point.x, yOffset + height, point.y));
      outer.forEach((point) => vertices.push(point.x, yOffset, point.y));
      inner.forEach((point) => vertices.push(point.x, yOffset, point.y));

      const topOuter = 0;
      const topInner = segments + 1;
      const bottomOuter = (segments + 1) * 2;
      const bottomInner = (segments + 1) * 3;

      for (let i = 0; i < segments; i += 1) {
        indices.push(topOuter + i, topOuter + i + 1, topInner + i);
        indices.push(topOuter + i + 1, topInner + i + 1, topInner + i);
        indices.push(bottomOuter + i + 1, bottomOuter + i, bottomInner + i);
        indices.push(bottomInner + i + 1, bottomOuter + i + 1, bottomInner + i);
        indices.push(topOuter + i + 1, topOuter + i, bottomOuter + i);
        indices.push(bottomOuter + i + 1, topOuter + i + 1, bottomOuter + i);
        indices.push(topInner + i, topInner + i + 1, bottomInner + i);
        indices.push(topInner + i + 1, bottomInner + i + 1, bottomInner + i);
      }

      for (const i of [0, segments]) {
        indices.push(topOuter + i, topInner + i, bottomOuter + i);
        indices.push(topInner + i, bottomInner + i, bottomOuter + i);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    }

    function createCar(index = 0, options = {}) {
      const group = new THREE.Group();
      const bodyColor = options.color ?? CONFIG.colors.cars[index % CONFIG.colors.cars.length];
      const black = 0x050604;
      const chassisMat = new THREE.MeshBasicMaterial({ color: black });
      const bodyMat = new THREE.MeshBasicMaterial({ color: bodyColor });
      const trimMat = new THREE.MeshBasicMaterial({ color: black });
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf4bf3a });
      const darkMat = new THREE.MeshBasicMaterial({ color: black });
      const wheelMat = new THREE.MeshBasicMaterial({ color: black });
      const hubMat = new THREE.MeshBasicMaterial({ color: black });

      const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 1.18), chassisMat);
      chassis.position.y = 0.27;
      group.add(chassis);

      const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 0.14), trimMat);
      frontBumper.position.set(0, 0.29, -0.66);
      group.add(frontBumper);

      const rearStay = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.12), trimMat);
      rearStay.position.set(0, 0.31, 0.58);
      group.add(rearStay);

      const shell = new THREE.Group();
      const mainShell = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.72), bodyMat);
      mainShell.position.y = 0.45;
      shell.add(mainShell);

      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.38), bodyMat);
      nose.position.set(0, 0.4, -0.48);
      nose.rotation.x = -0.18;
      shell.add(nose);

      const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.24), darkMat);
      cockpit.position.set(0, 0.62, -0.08);
      cockpit.rotation.x = -0.1;
      shell.add(cockpit);

      const canopyHighlight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.16), trimMat);
      canopyHighlight.position.set(0, 0.735, -0.12);
      shell.add(canopyHighlight);

      const centerStripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.64), stripeMat);
      centerStripe.position.set(0, 0.585, -0.18);
      centerStripe.rotation.x = -0.08;
      shell.add(centerStripe);

      const engineCover = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.15, 0.26), bodyMat);
      engineCover.position.set(0, 0.56, 0.29);
      engineCover.rotation.x = 0.12;
      shell.add(engineCover);

      for (const x of [-0.12, 0, 0.12]) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.18), darkMat);
        vent.position.set(x, 0.65, 0.26);
        shell.add(vent);
      }
      for (const x of [-0.31, 0.31]) {
        const sidePod = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.42), bodyMat);
        sidePod.position.set(x, 0.39, 0.14);
        sidePod.rotation.z = x < 0 ? 0.16 : -0.16;
        shell.add(sidePod);
      }
      group.add(shell);

      const wingDeck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.28), bodyMat);
      wingDeck.position.set(0, 0.72, 0.63);
      wingDeck.rotation.x = 0.16;
      group.add(wingDeck);

      const wingStripe = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.025, 0.05), stripeMat);
      wingStripe.position.set(0, 0.765, 0.55);
      wingStripe.rotation.x = 0.16;
      group.add(wingStripe);

      for (const x of [-0.4, 0.4]) {
        const wingPlate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.26), trimMat);
        wingPlate.position.set(x, 0.75, 0.63);
        wingPlate.rotation.z = x < 0 ? -0.18 : 0.18;
        group.add(wingPlate);
      }

      for (const x of [-0.38, 0.38]) {
        for (const z of [-0.36, 0.38]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.13, 14), wheelMat);
          wheel.rotation.z = Math.PI * 0.5;
          wheel.position.set(x, 0.28, z);
          group.add(wheel);

          const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.145, 10), hubMat);
          hub.rotation.z = Math.PI * 0.5;
          hub.position.copy(wheel.position);
          group.add(hub);
        }
      }

      for (const x of [-0.52, 0.52]) {
        for (const z of [-0.64, 0.62]) {
          const stay = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.055), trimMat);
          stay.position.set(x * 0.78, 0.34, z);
          stay.rotation.y = x < 0 ? -0.24 : 0.24;
          group.add(stay);

          const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.035, 16), trimMat);
          roller.rotation.x = Math.PI * 0.5;
          roller.position.set(x, 0.36, z);
          group.add(roller);

          const rollerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.04, 10), darkMat);
          rollerCap.rotation.x = Math.PI * 0.5;
          rollerCap.position.copy(roller.position);
          group.add(rollerCap);
        }
      }

      const visual = new THREE.Group();
      while (group.children.length > 0) {
        visual.add(group.children[0]);
      }
      visual.rotation.y = Math.PI;
      group.add(visual);
      group.scale.setScalar(CONFIG.carScale);
      return group;
    }

    function makeEraseMarker() {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: CONFIG.colors.previewBad, transparent: true, opacity: 0.62 });
      const a = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.tile * 0.9, 0.08, 0.16), mat);
      const b = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.tile * 0.9, 0.08, 0.16), mat);
      a.rotation.y = Math.PI / 4;
      b.rotation.y = -Math.PI / 4;
      a.position.y = b.position.y = 0.2;
      group.add(a, b);
      return group;
    }

    function startDrive() {
      const path = buildDrivePath();
      if (path.length < 3) {
        showToast('需要起點和相連的賽道');
        return;
      }
      state.carPath = path;
      state.carSpeed = CONFIG.physics.startSpeed;
      state.carPressure = 0;
      state.carStopped = false;
      state.lastSlope = 0;
      state.selectedKey = null;
      redrawTrack();
      const startDir = path[1].pos.clone().sub(path[0].pos).normalize();
      carActors.forEach((actor, index) => {
        launchActorOnPath(actor, index, path, startDir);
      });
      setMode('drive');
      showToast(`${state.carCount} 台車 Cannon 物理試跑開始`);
    }

    function launchActorOnCurrentTrack(actor, index) {
      const path = state.carPath.length > 2 ? state.carPath : buildDrivePath();
      if (path.length < 3) return;
      state.carPath = path;
      const startDir = path[1].pos.clone().sub(path[0].pos).normalize();
      launchActorOnPath(actor, index, path, startDir);
      actor.mesh.visible = true;
      state.carStopped = false;
      updateHud();
    }

    function launchActorOnPath(actor, index, path, startDir) {
      const sideDir = new THREE.Vector3(-startDir.z, 0, startDir.x);
      actor.laneIndex = index % state.laneCount;
      const stagger = index * CONFIG.physics.carRadius * 2.8;
      const laneOffset = getLaneOffset(actor.laneIndex);
      const startPos = path[0].pos
        .clone()
        .add(startDir.clone().multiplyScalar(-stagger))
        .add(sideDir.clone().multiplyScalar(laneOffset));
      actor.lanePath = buildActorLanePath(actor.laneIndex);
      actor.targetIndex = 1;
      actor.speed = actor.params.startSpeed;
      actor.pressure = 0;
      actor.stopped = false;
      actor.finished = false;
      actor.lowSpeedTime = 0;
      actor.derailed = false;
      actor.derailState = 'none';
      actor.flightVelocity.set(0, 0, 0);
      actor.spinVelocity.set(0, 0, 0);
      actor.flightTime = 0;
      actor.derailedFromRaisedCrossover = false;
      actor.derailHitCount = 0;
      actor.derailHitCooldown = 0;
      actor.flipTimer = 0;
      actor.flipYaw = 0;
      actor.mesh.rotation.set(0, 0, 0);
      actor.mesh.visible = true;
      actor.body.position.set(startPos.x, startPos.y, startPos.z);
      actor.body.velocity.set(startDir.x * actor.params.startSpeed, 0, startDir.z * actor.params.startSpeed);
      actor.body.force.set(0, 0, 0);
      placeCarAt(actor, { pos: startPos }, actor.lanePath[Math.min(1, actor.lanePath.length - 1)]);
    }

    function buildDrivePath() {
      const route = buildDriveRoute();
      if (route.length < 2) return [];
      const path = buildSampledPath(route);
      path.isLoop = Boolean(route.isLoop);
      state.trackLoops = path.isLoop;
      return path;
    }

    function buildDriveRoute() {
      const start = [...state.pieces.values()].find((piece) => piece.type === 'start');
      if (!start) return [];
      const route = [];
      let current = start;
      let incoming = null;
      const visited = new Set([cellKey(current.x, current.z)]);

      for (let i = 0; i < 80; i += 1) {
        const dir = getExitDirection(current, incoming);
        if (dir === null) break;
        route.push({ piece: current, incoming, exit: dir });
        const stepCells = getPieceStepCells(current, dir);
        const nextCell = {
          x: current.x + DIRS[dir].x * stepCells,
          z: current.z + DIRS[dir].y * stepCells,
        };
        const next = findPieceAtCell(nextCell.x, nextCell.z);
        const nextIncoming = (dir + 2) % 4;
        if (next && getExitDirection(next, nextIncoming) === null) break;
        if (!next) break;
        if (visited.has(cellKey(next.x, next.z))) {
          if (next.type === 'start') {
            const startExit = getExitDirection(next, nextIncoming);
            if (startExit !== null) {
              route.isLoop = true;
            }
          }
          break;
        }
        visited.add(cellKey(next.x, next.z));
        current = next;
        incoming = nextIncoming;
      }
      return route;
    }

    function getExitDirection(piece, incoming) {
      const forward = piece.rotation;
      const back = (piece.rotation + 2) % 4;
      if (piece.type === 'start') return forward;
      if (piece.type === 'straight' || isLaneTransitionPiece(piece.type)) {
        if (incoming === null) return forward;
        if (incoming === back) return forward;
        if (incoming === forward) return back;
        return null;
      }
      const side = piece.type === 'curveL' ? (piece.rotation + 3) % 4 : (piece.rotation + 1) % 4;
      if (incoming === back) return side;
      if (incoming === side) return back;
      return null;
    }

    function getPieceStepCells(piece, dir) {
      return dir === piece.rotation ? getPieceCellLength(piece.type) : 1;
    }

    function buildSampledPath(route) {
      const samples = [];
      route.forEach((node, index) => {
        const pieceSamples = samplePiecePath(node);
        pieceSamples.forEach((sample) => {
          const last = samples[samples.length - 1];
          if (!last || last.pos.distanceTo(sample.pos) > 0.03) {
            samples.push(sample);
          }
        });
        if (index === route.length - 1) {
          const exit = edgePoint(node.piece, node.exit);
          samples.push({ pos: exit, piece: node.piece });
        }
      });
      if (route.isLoop && samples.length > 2 && samples[0].pos.distanceTo(samples[samples.length - 1].pos) < 0.08) {
        samples.pop();
      }
      assignPathNormals(samples, Boolean(route.isLoop));
      return samples;
    }

    function assignPathNormals(samples, isLoop = false) {
      samples.forEach((sample, index) => {
        const prevIndex = isLoop ? (index - 1 + samples.length) % samples.length : Math.max(0, index - 1);
        const nextIndex = isLoop ? (index + 1) % samples.length : Math.min(samples.length - 1, index + 1);
        const prev = samples[prevIndex].pos;
        const next = samples[nextIndex].pos;
        const tangent = next.clone().sub(prev);
        tangent.y = 0;
        if (tangent.lengthSq() <= 0.0001) {
          tangent.copy(new THREE.Vector3(0, 0, -1));
        } else {
          tangent.normalize();
        }
        sample.normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      });
    }

    function buildActorLanePath(startLaneIndex) {
      const nodes = [];
      let lane = startLaneIndex;
      const lapCount = state.trackLoops ? getLaneCycleLapCount(startLaneIndex) : 1;
      for (let lap = 0; lap < lapCount; lap += 1) {
        let index = 0;
        while (index < state.carPath.length) {
          const piece = state.carPath[index].piece;
          let end = index + 1;
          while (end < state.carPath.length && state.carPath[end].piece === piece) end += 1;
          const laneStart = lane;
          const laneEnd = getLaneEndForPiece(piece?.type, lane);
          const span = Math.max(1, end - index - 1);
          for (let i = index; i < end; i += 1) {
            const t = (i - index) / span;
            const laneFloat = getLaneFloatForPiece(piece?.type, laneStart, laneEnd, t);
            const baseNode = state.carPath[i];
            const pos = offsetPathNodeForLaneFloat(baseNode, laneFloat);
            pos.y += getLaneVerticalOffset(piece?.type, laneStart, laneEnd, t);
            nodes.push({
              ...baseNode,
              pos,
              laneFloat,
              laneStart,
              laneEnd,
              pieceT: t,
              raisedCrossover: isRaisedCrossoverRoute(piece?.type, laneStart, laneEnd),
            });
            if (nodes.length > 1 && nodes[nodes.length - 2].pos.distanceTo(nodes[nodes.length - 1].pos) < 0.02) {
              nodes.pop();
            }
          }
          lane = laneEnd;
          index = end;
        }
      }
      return nodes;
    }

    function getLaneCycleLapCount(startLaneIndex) {
      let lane = startLaneIndex;
      for (let lap = 1; lap <= 12; lap += 1) {
        lane = getLapEndLane(lane);
        if (lane === startLaneIndex) return lap;
      }
      return 12;
    }

    function getLapEndLane(startLaneIndex) {
      let lane = startLaneIndex;
      let index = 0;
      while (index < state.carPath.length) {
        const piece = state.carPath[index].piece;
        let end = index + 1;
        while (end < state.carPath.length && state.carPath[end].piece === piece) end += 1;
        lane = getLaneEndForPiece(piece?.type, lane);
        index = end;
      }
      return lane;
    }

    function getLaneEndForPiece(type, lane) {
      if (state.laneCount < 2) return lane;
      if (type === 'crossover') {
        return (lane + state.laneCount - 1) % state.laneCount;
      }
      return lane;
    }

    function getLaneFloatForPiece(type, laneStart, laneEnd, t) {
      const eased = t * t * (3 - 2 * t);
      if (type === 'wave') {
        return laneStart + Math.sin(Math.PI * 2 * t) * 0.18;
      }
      if (type === 'crossover' && laneStart === 0 && laneEnd === state.laneCount - 1) {
        return THREE.MathUtils.lerp(laneStart, laneEnd, eased) + Math.sin(Math.PI * 2 * t) * -0.26;
      }
      if (type === 'crossover' && laneStart !== 0) {
        const waveAmount = laneStart === 2 ? 0.22 : 0.24;
        const wave = Math.sin(Math.PI * 2 * t) * waveAmount;
        return THREE.MathUtils.lerp(laneStart, laneEnd, eased) + wave;
      }
      return THREE.MathUtils.lerp(laneStart, laneEnd, eased);
    }

    function getLaneVerticalOffset(type, laneStart, laneEnd, t) {
      if (isRaisedCrossoverRoute(type, laneStart, laneEnd)) {
        return Math.sin(Math.PI * t) * 0.58;
      }
      return 0;
    }

    function isRaisedCrossoverRoute(type, laneStart, laneEnd) {
      return type === 'crossover' && state.laneCount >= 3 && laneStart === 0 && laneEnd === state.laneCount - 1;
    }

    function samplePiecePath(node) {
      if (node.piece.type === 'curveL' || node.piece.type === 'curveR') {
        return sampleCurvePiece(node);
      }
      const start = node.incoming === null
        ? edgePoint(node.piece, (node.exit + 2) % 4)
        : edgePoint(node.piece, node.incoming);
      const end = edgePoint(node.piece, node.exit);
      if (isLaneTransitionPiece(node.piece.type)) {
        const samples = [];
        for (let i = 0; i <= 24; i += 1) {
          samples.push({
            pos: start.clone().lerp(end, i / 24),
            piece: node.piece,
          });
        }
        return samples;
      }
      return [
        { pos: start, piece: node.piece },
        { pos: end, piece: node.piece },
      ];
    }

    function sampleCurvePiece(node) {
      const entry = edgePoint(node.piece, node.incoming ?? (node.exit + 2) % 4);
      const exit = edgePoint(node.piece, node.exit);
      const center = curveCenter(node.piece);
      const radius = CONFIG.tile * 0.5;
      let startAngle = Math.atan2(entry.z - center.z, entry.x - center.x);
      let endAngle = Math.atan2(exit.z - center.z, exit.x - center.x);
      let deltaAngle = endAngle - startAngle;
      while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
      while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

      const samples = [];
      for (let i = 0; i <= CONFIG.physics.cornerSamples; i += 1) {
        const t = i / CONFIG.physics.cornerSamples;
        const angle = startAngle + deltaAngle * t;
        samples.push({
          pos: new THREE.Vector3(
            center.x + Math.cos(angle) * radius,
            driveHeight(node.piece),
            center.z + Math.sin(angle) * radius
          ),
          piece: node.piece,
        });
      }
      return samples;
    }

    function edgePoint(piece, dir) {
      const center = pieceCenter(piece);
      const forward = piece.rotation;
      const back = (piece.rotation + 2) % 4;
      let distance = 0.5;
      if (dir === forward) distance = getPieceCellLength(piece.type) - 0.5;
      if (dir === back) distance = 0.5;
      return new THREE.Vector3(
        center.x + DIRS[dir].x * CONFIG.tile * distance,
        center.y,
        center.z + DIRS[dir].y * CONFIG.tile * distance
      );
    }

    function curveCenter(piece) {
      const back = (piece.rotation + 2) % 4;
      const side = piece.type === 'curveL' ? (piece.rotation + 3) % 4 : (piece.rotation + 1) % 4;
      const center = pieceCenter(piece);
      return new THREE.Vector3(
        center.x + (DIRS[back].x + DIRS[side].x) * CONFIG.tile * 0.5,
        center.y,
        center.z + (DIRS[back].y + DIRS[side].y) * CONFIG.tile * 0.5
      );
    }

    function updateCar(dt) {
      if (state.mode !== 'drive' || state.carPath.length < 2) return;
      carActors.forEach((actor) => {
        actor.derailed ? updateDerailedCar(actor, dt) : applyDrivePhysics(actor, dt);
      });
      if (carActors.every((actor) => actor.stopped)) {
        summarizeCars();
        updateHud();
        return;
      }
      physicsWorld.step(CONFIG.physics.fixedStep, dt, 3);
      carActors.forEach((actor) => {
        if (!actor.stopped && !actor.derailed) {
          resolveCrossoverUnderpassConstraint(actor);
          resolveRailCollision(actor);
          resolveActiveCarObstacleCollision(actor);
        }
        if (!actor.derailed) syncCarFromPhysics(actor);
      });
      summarizeCars();
      updateHud();
    }

    function placeCarAt(actor, a, b) {
      actor.mesh.position.copy(a.pos);
      actor.mesh.position.y += CONFIG.carVisualYOffset;
      actor.mesh.lookAt(b.pos.x, actor.mesh.position.y, b.pos.z);
    }

    function applyDrivePhysics(actor, dt) {
      if (actor.stopped) return;
      const guide = getGuideTarget(actor);
      if (!guide) {
        actor.finished = true;
        actor.stopped = true;
        actor.speed = 0;
        actor.body.velocity.set(0, 0, 0);
        if (carActors.every((carActor) => carActor.stopped)) {
          showToast('全部車抵達終點');
          setTimeout(() => setMode('edit'), 800);
        }
        return;
      }

      const physics = CONFIG.physics;
      const current = new THREE.Vector3(actor.body.position.x, actor.body.position.y, actor.body.position.z);
      const desired = guide.target.clone().sub(current);
      const dir = new THREE.Vector3(desired.x, 0, desired.z);
      if (dir.lengthSq() > 0.0001) dir.normalize();

      const speed = Math.hypot(actor.body.velocity.x, actor.body.velocity.z);
      actor.speed = speed;
      const targetSpeed = THREE.MathUtils.clamp(speed + actor.params.motorAccel * dt, actor.params.startSpeed, actor.params.maxSpeed);
      const targetVelocity = dir.clone().multiplyScalar(targetSpeed);
      const steerX = (targetVelocity.x - actor.body.velocity.x) * physics.guideStrength;
      const steerZ = (targetVelocity.z - actor.body.velocity.z) * physics.guideStrength;
      const centerCorrection = getCenteringCorrection(current, guide);
      applyTireFriction(actor, dir, dt);
      const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);
      const wander = Math.sin(performance.now() * 0.006 + actor.index * 2.1 + actor.targetIndex * 0.37)
        * physics.tireWander
        * Math.min(actor.speed / actor.params.maxSpeed, 1);
      actor.body.force.set(
        steerX + centerCorrection.x * physics.centeringStrength + sideDir.x * wander,
        0,
        steerZ + centerCorrection.z * physics.centeringStrength + sideDir.z * wander
      );

      state.lastSlope = guide.slope;
      if (guide.slope > 0) {
        actor.body.velocity.scale(Math.max(0.86, 1 - guide.slope * physics.uphillLoss * dt), actor.body.velocity);
      }
      if (guide.slope < 0) {
        actor.body.velocity.x += dir.x * Math.abs(guide.slope) * physics.downhillBoost * dt;
        actor.body.velocity.z += dir.z * Math.abs(guide.slope) * physics.downhillBoost * dt;
      }

      if (guide.piece?.type === 'curveL' || guide.piece?.type === 'curveR') {
        const excess = Math.max(0, actor.speed - physics.curveSafeSpeed);
        actor.pressure += excess * excess * physics.curvePressure * dt * 0.28;
        if (excess > 0) actor.body.velocity.scale(Math.max(0.82, 1 - physics.curveRailLoss * dt), actor.body.velocity);
      } else if (guide.piece?.type === 'crossover' || guide.piece?.type === 'wave') {
        if (guide.piece?.type === 'wave' || guide.prev.raisedCrossover || guide.node.raisedCrossover) {
          const excess = Math.max(0, actor.speed - physics.curveSafeSpeed * 1.12);
          actor.pressure += excess * excess * physics.curvePressure * dt * 0.18;
        } else {
          actor.pressure = Math.max(0, actor.pressure - physics.stabilityRecover * dt * 0.5);
        }
      } else {
        actor.pressure = Math.max(0, actor.pressure - physics.stabilityRecover * dt);
      }

      const currentSpeed = Math.hypot(actor.body.velocity.x, actor.body.velocity.z);
      if (currentSpeed > actor.params.maxSpeed) {
        actor.body.velocity.scale(actor.params.maxSpeed / currentSpeed, actor.body.velocity);
      }
      const boostedSpeed = Math.hypot(actor.body.velocity.x, actor.body.velocity.z);
      if (boostedSpeed < physics.minMotorSpeed && dir.lengthSq() > 0.0001) {
        actor.body.velocity.x += dir.x * (physics.minMotorSpeed - boostedSpeed) * 0.18;
        actor.body.velocity.z += dir.z * (physics.minMotorSpeed - boostedSpeed) * 0.18;
      }
      actor.speed = Math.hypot(actor.body.velocity.x, actor.body.velocity.z);

      if (guide.slope > 0.08 && actor.speed < physics.minClimbSpeed) {
        failDrive(actor, `第 ${actor.index + 1} 台上坡速度不夠`);
        return;
      }

      actor.lowSpeedTime = actor.speed <= physics.stallSpeed ? actor.lowSpeedTime + dt : 0;
      if (actor.lowSpeedTime > 1.2) {
        failDrive(actor, `第 ${actor.index + 1} 台速度太低`);
        return;
      }

      if (actor.pressure >= physics.derailPressure) {
        derailCar(actor, guide);
      }
    }

    function applyTireFriction(actor, forwardDir, dt) {
      const sideDir = new THREE.Vector3(-forwardDir.z, 0, forwardDir.x);
      const lateralSpeed = actor.body.velocity.x * sideDir.x + actor.body.velocity.z * sideDir.z;
      const damping = THREE.MathUtils.clamp(CONFIG.physics.lateralFriction * dt, 0, 0.5);
      actor.body.velocity.x -= sideDir.x * lateralSpeed * damping;
      actor.body.velocity.z -= sideDir.z * lateralSpeed * damping;
    }

    function getCenteringCorrection(current, guide) {
      const nearest = closestPointOnSegment(current, guide.prev.pos, guide.node.pos);
      const correction = nearest.clone().sub(current);
      correction.y = 0;
      const offset = correction.length();
      if (offset > CONFIG.physics.maxCenterOffset) {
        correction.setLength(CONFIG.physics.maxCenterOffset);
      }
      return correction;
    }

    function resolveRailCollision(actor) {
      const current = new THREE.Vector3(actor.body.position.x, actor.body.position.y, actor.body.position.z);
      const railHit = state.laneCount > 1
        ? getNearestLaneBoundary(actor, current)
        : getNearestTrackBoundary(current);
      if (!railHit || railHit.offset <= railHit.limit) return;

      const normal = current.clone().sub(railHit.nearest);
      normal.y = 0;
      if (normal.lengthSq() <= 0.0001) return;
      normal.normalize();

      const corrected = railHit.nearest.clone().add(normal.clone().multiplyScalar(railHit.limit));
      actor.body.position.x = corrected.x;
      actor.body.position.z = corrected.z;

      const velocity = new THREE.Vector3(actor.body.velocity.x, 0, actor.body.velocity.z);
      const normalSpeed = velocity.dot(normal);
      const normalVelocity = normal.clone().multiplyScalar(normalSpeed);
      const tangentVelocity = velocity.clone().sub(normalVelocity).multiplyScalar(CONFIG.physics.railFriction);
      const bouncedNormal = normalSpeed > 0
        ? normal.clone().multiplyScalar(-normalSpeed * CONFIG.physics.railRestitution)
        : normalVelocity;
      const resolved = tangentVelocity.add(bouncedNormal);
      actor.body.velocity.x = resolved.x;
      actor.body.velocity.z = resolved.z;
      actor.pressure = Math.min(
        CONFIG.physics.derailPressure * 0.96,
        actor.pressure + 0.12 + Math.max(0, normalSpeed) * 0.04
      );
    }

    function resolveActiveCarObstacleCollision(actor) {
      const current = new THREE.Vector3(actor.body.position.x, 0, actor.body.position.z);
      carActors.forEach((other) => {
        if (other === actor || !other.mesh.visible || !other.derailed) return;
        const obstacle = new THREE.Vector3(other.mesh.position.x, 0, other.mesh.position.z);
        const delta = current.clone().sub(obstacle);
        const distance = delta.length();
        const minDistance = CONFIG.physics.derailCollisionRadius + CONFIG.physics.carRadius;
        if (distance <= 0.0001 || distance >= minDistance) return;

        const normal = delta.multiplyScalar(1 / distance);
        const push = minDistance - distance + 0.004;
        actor.body.position.x += normal.x * push;
        actor.body.position.z += normal.z * push;

        const velocity = new THREE.Vector3(actor.body.velocity.x, 0, actor.body.velocity.z);
        const obstacleVelocity = new THREE.Vector3(other.flightVelocity.x, 0, other.flightVelocity.z);
        const relativeSpeed = velocity.clone().sub(obstacleVelocity).dot(normal);
        if (relativeSpeed >= 0) return;

        const tangentVelocity = velocity.clone().sub(normal.clone().multiplyScalar(relativeSpeed)).multiplyScalar(0.35);
        const bounced = normal.clone().multiplyScalar(-relativeSpeed * CONFIG.physics.derailCarBounce);
        actor.body.velocity.x = tangentVelocity.x + bounced.x;
        actor.body.velocity.z = tangentVelocity.z + bounced.z;
        actor.pressure = Math.min(CONFIG.physics.derailPressure * 0.98, actor.pressure + Math.abs(relativeSpeed) * 0.16);

        if (!other.stopped) {
          const shove = -relativeSpeed * 0.45;
          other.flightVelocity.x -= normal.x * shove;
          other.flightVelocity.z -= normal.z * shove;
        }
      });
    }

    function resolveCrossoverUnderpassConstraint(actor) {
      if (state.laneCount < 3) return;
      const guide = getGuideTarget(actor, false);
      if (guide?.piece?.type !== 'crossover' || guide.node.raisedCrossover || guide.prev.raisedCrossover) return;
      const bridge = getRaisedCrossoverBridgeHit(guide.piece, actor.body.position);
      if (!bridge) return;

      const undersideY = bridge.surfaceY - CONFIG.trackHeight - CONFIG.physics.invertedGroundClearance;
      const lowerGroundY = getGuideGroundY(actor, guide);
      if (undersideY <= lowerGroundY + 0.04) return;
      if (actor.body.position.y <= undersideY) return;
      actor.body.position.y = undersideY;
      actor.body.velocity.y = Math.min(0, actor.body.velocity.y);
    }

    function getGuideGroundY(actor, guide) {
      const current = new THREE.Vector3(actor.body.position.x, 0, actor.body.position.z);
      const prev = new THREE.Vector3(guide.prev.pos.x, 0, guide.prev.pos.z);
      const next = new THREE.Vector3(guide.node.pos.x, 0, guide.node.pos.z);
      const projected = closestPointOnSegmentWithT(current, prev, next);
      return THREE.MathUtils.lerp(guide.prev.pos.y, guide.node.pos.y, projected.t);
    }

    function getRaisedCrossoverBridgeHit(piece, point) {
      const probe = new THREE.Vector3(point.x, point.y ?? 0, point.z);
      const path = getRaisedCrossoverWorldPath(piece);
      let best = null;
      for (let i = 0; i < path.length - 1; i += 1) {
        const hit = closestPointOnSegmentWithT(probe, path[i].pos, path[i + 1].pos);
        const flatDelta = probe.clone().sub(hit.point);
        flatDelta.y = 0;
        const offset = flatDelta.length();
        const limit = getLaneWidth() * 0.5 + CONFIG.physics.carRadius;
        if (offset > limit) continue;
        const t = THREE.MathUtils.lerp(path[i].t, path[i + 1].t, hit.t);
        const surfaceY = driveHeight(piece) + getLaneVerticalOffset('crossover', 0, state.laneCount - 1, t);
        if (!best || surfaceY > best.surfaceY || offset < best.offset) {
          best = { offset, surfaceY };
        }
      }
      return best;
    }

    function getRaisedCrossoverWorldPath(piece) {
      const rotation = -piece.rotation * Math.PI * 0.5;
      const origin = new THREE.Vector3(piece.x * CONFIG.tile, 0, piece.z * CONFIG.tile);
      return createLaneLocalPath('crossover', 0, 36, 0).map((point) => {
        const pos = new THREE.Vector3(point.x, 0, point.z)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation)
          .add(origin);
        return { pos, t: point.t };
      });
    }

    function getNearestTrackBoundary(point) {
      let best = null;
      for (let i = 0; i < state.carPath.length - 1; i += 1) {
        const a = state.carPath[i].pos;
        const b = state.carPath[i + 1].pos;
        const nearest = closestPointOnSegment(point, a, b);
        const flatDelta = point.clone().sub(nearest);
        flatDelta.y = 0;
        const offset = flatDelta.length();
        if (!best || offset < best.offset) {
          best = {
            nearest,
            offset,
            limit: getTrackWidth() * 0.5 - CONFIG.physics.carRadius,
          };
        }
      }
      if (state.trackLoops && state.carPath.length > 2) {
        const a = state.carPath[state.carPath.length - 1].pos;
        const b = state.carPath[0].pos;
        const nearest = closestPointOnSegment(point, a, b);
        const flatDelta = point.clone().sub(nearest);
        flatDelta.y = 0;
        const offset = flatDelta.length();
        if (!best || offset < best.offset) {
          best = {
            nearest,
            offset,
            limit: getTrackWidth() * 0.5 - CONFIG.physics.carRadius,
          };
        }
      }
      return best;
    }

    function getNearestLaneBoundary(actor, point) {
      let best = null;
      const path = actor.lanePath.length > 1 ? actor.lanePath : state.carPath;
      const isLoop = state.trackLoops && path.length > 2;
      const centerIndex = THREE.MathUtils.clamp(actor.targetIndex - 1, 0, Math.max(0, path.length - 1));
      const windowSize = CONFIG.physics.laneCollisionWindow;
      const visitSegment = (i, nextIndex) => {
        const a = path[i].pos;
        const b = path[nextIndex].pos;
        const nearest = closestPointOnSegment(point, a, b);
        const flatDelta = point.clone().sub(nearest);
        flatDelta.y = 0;
        const offset = flatDelta.length();
        if (!best || offset < best.offset) {
          best = {
            nearest,
            offset,
            limit: getLaneWidth() * 0.5 - CONFIG.physics.carRadius + CONFIG.physics.laneClearance,
          };
        }
      };

      for (let delta = -windowSize; delta <= windowSize; delta += 1) {
        let i = centerIndex + delta;
        if (isLoop) {
          i = (i + path.length) % path.length;
          visitSegment(i, (i + 1) % path.length);
        } else if (i >= 0 && i < path.length - 1) {
          visitSegment(i, i + 1);
        }
      }
      return best;
    }

    function closestPointOnSegment(point, a, b) {
      const ab = b.clone().sub(a);
      const lengthSq = ab.lengthSq();
      if (lengthSq <= 0.0001) return a.clone();
      const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
      return a.clone().add(ab.multiplyScalar(t));
    }

    function closestPointOnSegmentWithT(point, a, b) {
      const ab = b.clone().sub(a);
      const lengthSq = ab.lengthSq();
      if (lengthSq <= 0.0001) return { point: a.clone(), t: 0 };
      const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
      return { point: a.clone().add(ab.multiplyScalar(t)), t };
    }

    function getGuideTarget(actor, advance = true) {
      const current = new THREE.Vector3(actor.body.position.x, actor.body.position.y, actor.body.position.z);
      const path = actor.lanePath.length > 1 ? actor.lanePath : state.carPath;
      const isLoop = state.trackLoops && path.length > 2;
      while (advance) {
        const here = path[actor.targetIndex].pos;
        if (current.distanceTo(here) > CONFIG.physics.lookAhead) break;
        actor.targetIndex += 1;
        if (isLoop) actor.targetIndex %= path.length;
        if (!isLoop && actor.targetIndex >= path.length) return null;
      }
      if (!isLoop && actor.targetIndex >= path.length) return null;
      const node = path[actor.targetIndex];
      const prevIndex = isLoop
        ? (actor.targetIndex - 1 + path.length) % path.length
        : Math.max(0, actor.targetIndex - 1);
      const prev = path[prevIndex];
      const lanePrev = prev.pos;
      const laneTarget = node.pos;
      const span = Math.max(lanePrev.distanceTo(laneTarget), 0.001);
      return {
        target: laneTarget,
        piece: node.piece,
        slope: (laneTarget.y - lanePrev.y) / span,
        prev: { ...prev, pos: lanePrev },
        node: { ...node, pos: laneTarget },
      };
    }

    function offsetPathNodeForLane(node, laneIndex) {
      return offsetPathNodeForLaneFloat(node, laneIndex);
    }

    function offsetPathNodeForLaneFloat(node, laneFloat) {
      const laneOffset = getLaneOffsetForFloat(laneFloat);
      if (Math.abs(laneOffset) < 0.001 || !node.normal) return node.pos.clone();
      return node.pos.clone().add(node.normal.clone().multiplyScalar(laneOffset));
    }

    function failDrive(actor, message) {
      actor.stopped = true;
      actor.speed = 0;
      actor.body.velocity.set(0, 0, 0);
      showToast(message);
      if (carActors.every((carActor) => carActor.stopped)) {
        setTimeout(() => setMode('edit'), 900);
      }
      updateHud();
    }

    function derailCar(actor, guide) {
      const tangent = new THREE.Vector3().subVectors(guide.node.pos, guide.prev.pos);
      tangent.y = 0;
      if (tangent.lengthSq() <= 0.0001) tangent.set(0, 0, -1);
      tangent.normalize();

      const velocity = new THREE.Vector3(actor.body.velocity.x, 0, actor.body.velocity.z);
      const sideSign = velocity.dot(new THREE.Vector3(-tangent.z, 0, tangent.x)) >= 0 ? 1 : -1;
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(sideSign);
      const forwardSpeed = Math.max(velocity.length(), actor.speed, 2.2);

      actor.derailed = true;
      actor.derailState = 'flying';
      actor.stopped = false;
      actor.finished = true;
      actor.pressure = CONFIG.physics.derailPressure;
      actor.flightTime = 0;
      actor.derailedFromRaisedCrossover = Boolean(guide.prev.raisedCrossover || guide.node.raisedCrossover);
      actor.derailHitCount = 0;
      actor.derailHitCooldown = 0;
      actor.flipTimer = 0;
      actor.flightVelocity.copy(tangent.multiplyScalar(forwardSpeed * 0.92));
      actor.flightVelocity.add(side.multiplyScalar(forwardSpeed * 0.38));
      actor.flightVelocity.y = Math.min(4.8, 1.6 + forwardSpeed * 0.16);
      actor.spinVelocity.set(
        4.2 + Math.random() * 3.2,
        (Math.random() - 0.5) * 2.4,
        sideSign * (5.8 + Math.random() * 3.6)
      );
      actor.body.velocity.set(0, 0, 0);
      actor.body.force.set(0, 0, 0);
      showToast(`第 ${actor.index + 1} 台飛出軌`);
    }

    function updateDerailedCar(actor, dt) {
      if (actor.stopped) return;
      actor.derailHitCooldown = Math.max(0, actor.derailHitCooldown - dt);
      if (actor.derailState === 'flipping') {
        updateForcedFlipCar(actor, dt);
        return;
      }
      if (actor.derailState === 'offtrack') {
        updateOffTrackCar(actor, dt);
        return;
      }
      if (actor.derailState === 'wrecked') {
        updateWreckedCar(actor, dt);
        return;
      }

      actor.flightTime += dt;
      actor.flightVelocity.y -= CONFIG.physics.flightGravity * dt;
      actor.flightVelocity.y *= Math.max(CONFIG.physics.flightAirDamping - dt * 0.08, 0.9);
      actor.mesh.position.add(actor.flightVelocity.clone().multiplyScalar(dt));
      resolveDerailedRailCollision(actor);
      resolveDerailedCarCollisions(actor);
      actor.mesh.rotation.x += actor.spinVelocity.x * dt;
      actor.mesh.rotation.y += actor.spinVelocity.y * dt;
      actor.mesh.rotation.z += actor.spinVelocity.z * dt;
      actor.speed = actor.flightVelocity.length();

      const groundY = getDerailedGroundY(actor.mesh.position, actor);
      if (actor.mesh.position.y <= groundY) {
        actor.mesh.position.y = groundY;
        resolveDerailLanding(actor);
      }
    }

    function resolveDerailLanding(actor) {
      const upright = getCarUpDot(actor) > CONFIG.physics.flightUprightThreshold;
      const landing = getLandingOnLane(actor);

      if (upright && landing) {
        rejoinTrack(actor, landing);
        showToast(`第 ${actor.index + 1} 台落回軌道`);
        return;
      }

      actor.flightVelocity.y = 0;
      actor.spinVelocity.multiplyScalar(0.32);
      if (!upright) {
        actor.derailState = 'wrecked';
        actor.flightVelocity.multiplyScalar(CONFIG.physics.flightGroundDamping);
        actor.spinVelocity.set(0, 0, 0);
        settleCarRotation(actor, true);
        showToast(`第 ${actor.index + 1} 台反車`);
        return;
      }

      actor.derailState = 'offtrack';
      actor.derailHitCount = 0;
      actor.derailHitCooldown = CONFIG.physics.offTrackHitCooldown;
      settleCarRotation(actor, false);
      alignCarToVelocity(actor);
      showToast(`第 ${actor.index + 1} 台衝出場外`);
    }

    function recordOffTrackHit(actor) {
      if (actor.derailState !== 'offtrack' || actor.derailHitCooldown > 0) return;
      actor.derailHitCount += 1;
      actor.derailHitCooldown = CONFIG.physics.offTrackHitCooldown;
      if (actor.derailHitCount >= CONFIG.physics.offTrackFlipHits) {
        startForcedFlip(actor);
      }
    }

    function startForcedFlip(actor) {
      actor.derailState = 'flipping';
      actor.flipTimer = 0;
      actor.flipYaw = actor.mesh.rotation.y;
      actor.spinVelocity.set(0, 0, 0);
      actor.flightVelocity.multiplyScalar(0.78);
      showToast(`第 ${actor.index + 1} 台撞到翻車`);
    }

    function updateForcedFlipCar(actor, dt) {
      actor.flightVelocity.y = 0;
      actor.flightVelocity.multiplyScalar(Math.pow(CONFIG.physics.wreckFriction, dt * 60));
      actor.mesh.position.add(actor.flightVelocity.clone().multiplyScalar(dt));
      actor.mesh.position.y = getDerailedGroundY(actor.mesh.position, actor);
      resolveDerailedRailCollision(actor);
      resolveDerailedCarCollisions(actor);

      actor.flipTimer += dt;
      const t = THREE.MathUtils.clamp(actor.flipTimer / CONFIG.physics.forcedFlipDuration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      actor.mesh.rotation.set(
        Math.PI * eased,
        actor.flipYaw,
        Math.sin(eased * Math.PI * 2) * 0.22
      );
      actor.speed = actor.flightVelocity.length();

      if (t >= 1) {
        actor.derailState = 'wrecked';
        actor.spinVelocity.set(0, 0, 0);
        settleCarRotation(actor, true);
      }
    }

    function getDerailedGroundY(point = null, actor = null) {
      const clearance = actor?.derailState === 'wrecked' || actor?.derailState === 'flipping'
        ? CONFIG.physics.invertedGroundClearance
        : CONFIG.physics.flightGroundClearance;
      const base = driveHeight(null) + CONFIG.carVisualYOffset + clearance;
      const surfaceHeight = point ? getNearestTrackSurfaceHeight(point) : null;
      return surfaceHeight === null
        ? base
        : Math.max(base, surfaceHeight + CONFIG.carVisualYOffset + clearance);
    }

    function getNearestTrackSurfaceHeight(point) {
      let best = null;
      const considerPath = (path, limit) => {
        if (!path || path.length < 2) return;
        for (let i = 0; i < path.length - 1; i += 1) {
          const hit = closestPointOnSegmentWithT(point, path[i].pos, path[i + 1].pos);
          const flatDelta = point.clone().sub(hit.point);
          flatDelta.y = 0;
          const offset = flatDelta.length();
          if (offset <= limit && (!best || offset < best.offset || hit.point.y > best.height)) {
            best = { offset, height: hit.point.y };
          }
        }
        if (state.trackLoops && path.length > 2) {
          const hit = closestPointOnSegmentWithT(point, path[path.length - 1].pos, path[0].pos);
          const flatDelta = point.clone().sub(hit.point);
          flatDelta.y = 0;
          const offset = flatDelta.length();
          if (offset <= limit && (!best || offset < best.offset || hit.point.y > best.height)) {
            best = { offset, height: hit.point.y };
          }
        }
      };

      considerPath(state.carPath, getTrackWidth() * 0.5 + CONFIG.physics.derailCollisionRadius);
      carActors.forEach((carActor) => {
        considerPath(carActor.lanePath, getLaneWidth() * 0.5 + CONFIG.physics.derailCollisionRadius);
      });
      return best ? best.height : null;
    }

    function settleCarRotation(actor, inverted) {
      const velocity = new THREE.Vector3(actor.flightVelocity.x, 0, actor.flightVelocity.z);
      let yaw = actor.mesh.rotation.y;
      if (velocity.lengthSq() > 0.0001) yaw = Math.atan2(velocity.x, velocity.z);
      actor.mesh.rotation.set(inverted ? Math.PI : 0, yaw, 0);
    }

    function resolveDerailedRailCollision(actor) {
      const railTop = CONFIG.trackHeight * 0.5 + CONFIG.railBaseOffset + CONFIG.railHeight * 0.5;
      if (actor.mesh.position.y - CONFIG.physics.derailCollisionRadius > railTop) return;

      const hit = getNearestPhysicalRail(actor.mesh.position);
      if (!hit || hit.offset >= CONFIG.physics.derailCollisionRadius) return;

      const normal = actor.mesh.position.clone().sub(hit.nearest);
      normal.y = 0;
      if (normal.lengthSq() <= 0.0001) {
        normal.copy(hit.normal);
      } else {
        normal.normalize();
      }
      const push = CONFIG.physics.derailCollisionRadius - hit.offset + 0.004;
      actor.mesh.position.add(normal.clone().multiplyScalar(push));

      const velocity = new THREE.Vector3(actor.flightVelocity.x, 0, actor.flightVelocity.z);
      const normalSpeed = velocity.dot(normal);
      if (normalSpeed >= 0) return;
      const tangentVelocity = velocity.clone().sub(normal.clone().multiplyScalar(normalSpeed)).multiplyScalar(CONFIG.physics.railFriction);
      const bounced = normal.clone().multiplyScalar(-normalSpeed * CONFIG.physics.derailRailBounce);
      actor.flightVelocity.x = tangentVelocity.x + bounced.x;
      actor.flightVelocity.z = tangentVelocity.z + bounced.z;
      actor.spinVelocity.multiplyScalar(0.72);
      recordOffTrackHit(actor);
    }

    function getNearestPhysicalRail(point) {
      if (state.carPath.length < 2) return null;
      const offsets = [];
      const halfWidth = getTrackWidth() * 0.5;
      for (let i = 0; i <= state.laneCount; i += 1) {
        offsets.push(-halfWidth + i * getLaneWidth());
      }
      let best = null;
      const visitSegment = (aNode, bNode, offset) => {
        if (!aNode.normal || !bNode.normal) return;
        const a = aNode.pos.clone().add(aNode.normal.clone().multiplyScalar(offset));
        const b = bNode.pos.clone().add(bNode.normal.clone().multiplyScalar(offset));
        const nearest = closestPointOnSegment(point, a, b);
        const delta = point.clone().sub(nearest);
        delta.y = 0;
        const offsetDistance = delta.length();
        if (!best || offsetDistance < best.offset) {
          const tangent = b.clone().sub(a);
          tangent.y = 0;
          const normal = tangent.lengthSq() > 0.0001
            ? new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
            : new THREE.Vector3(1, 0, 0);
          best = { nearest, offset: offsetDistance, normal };
        }
      };

      for (let i = 0; i < state.carPath.length - 1; i += 1) {
        offsets.forEach((offset) => visitSegment(state.carPath[i], state.carPath[i + 1], offset));
      }
      if (state.trackLoops && state.carPath.length > 2) {
        const last = state.carPath[state.carPath.length - 1];
        offsets.forEach((offset) => visitSegment(last, state.carPath[0], offset));
      }
      return best;
    }

    function resolveDerailedCarCollisions(actor) {
      carActors.forEach((other) => {
        if (other === actor || !other.mesh.visible) return;
        const otherIsObstacle = other.derailed || other.stopped;
        if (!otherIsObstacle) return;
        const delta = actor.mesh.position.clone().sub(other.mesh.position);
        delta.y = 0;
        const distance = delta.length();
        const minDistance = CONFIG.physics.derailCollisionRadius * 2;
        if (distance <= 0.0001 || distance >= minDistance) return;

        const normal = delta.multiplyScalar(1 / distance);
        const push = (minDistance - distance) * 0.5 + 0.002;
        actor.mesh.position.add(normal.clone().multiplyScalar(push));
        if (other.derailed && !other.stopped) {
          other.mesh.position.add(normal.clone().multiplyScalar(-push));
        }

        const actorVel = new THREE.Vector3(actor.flightVelocity.x, 0, actor.flightVelocity.z);
        const otherVel = other.derailed
          ? new THREE.Vector3(other.flightVelocity.x, 0, other.flightVelocity.z)
          : new THREE.Vector3(0, 0, 0);
        const relativeSpeed = actorVel.clone().sub(otherVel).dot(normal);
        if (relativeSpeed >= 0) return;

        const impulse = -relativeSpeed * CONFIG.physics.derailCarBounce;
        actor.flightVelocity.x -= normal.x * impulse;
        actor.flightVelocity.z -= normal.z * impulse;
        if (other.derailed && !other.stopped) {
          other.flightVelocity.x -= normal.x * impulse * 0.65;
          other.flightVelocity.z -= normal.z * impulse * 0.65;
          if (other.derailState !== 'wrecked') {
            other.spinVelocity.add(new THREE.Vector3(normal.z, 0, -normal.x).multiplyScalar(impulse * 0.5));
          }
        }
        if (actor.derailState !== 'wrecked') {
          actor.spinVelocity.add(new THREE.Vector3(-normal.z, 0, normal.x).multiplyScalar(impulse * 0.55));
        }
        recordOffTrackHit(actor);
        recordOffTrackHit(other);
      });
    }

    function getCarUpDot(actor) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(actor.mesh.quaternion);
      return up.dot(new THREE.Vector3(0, 1, 0));
    }

    function getLandingOnLane(actor) {
      if (!actor.lanePath || actor.lanePath.length < 2) return null;
      const point = actor.mesh.position.clone();
      let best = null;
      for (let i = 0; i < actor.lanePath.length - 1; i += 1) {
        const a = actor.lanePath[i].pos;
        const b = actor.lanePath[i + 1].pos;
        const hit = closestPointOnSegmentWithT(point, a, b);
        if (!canRejoinAtHeight(actor, point, hit.point)) continue;
        const flatDelta = point.clone().sub(hit.point);
        flatDelta.y = 0;
        const offset = flatDelta.length();
        if (!best || offset < best.offset) {
          best = {
            offset,
            point: hit.point,
            nextIndex: i + 1,
            tangent: b.clone().sub(a),
          };
        }
      }
      if (state.trackLoops && actor.lanePath.length > 2) {
        const lastIndex = actor.lanePath.length - 1;
        const a = actor.lanePath[lastIndex].pos;
        const b = actor.lanePath[0].pos;
        const hit = closestPointOnSegmentWithT(point, a, b);
        if (canRejoinAtHeight(actor, point, hit.point)) {
          const flatDelta = point.clone().sub(hit.point);
          flatDelta.y = 0;
          const offset = flatDelta.length();
          if (!best || offset < best.offset) {
            best = {
              offset,
              point: hit.point,
              nextIndex: 0,
              tangent: b.clone().sub(a),
            };
          }
        }
      }
      const limit = getLaneWidth() * 0.5 - CONFIG.physics.carRadius + CONFIG.physics.laneClearance;
      return best && best.offset <= limit ? best : null;
    }

    function canRejoinAtHeight(actor, carPoint, lanePoint) {
      const laneAboveCar = lanePoint.y - carPoint.y;
      if (laneAboveCar > CONFIG.physics.rejoinHeightTolerance) return false;

      const carAboveLane = carPoint.y - lanePoint.y;
      if (carAboveLane <= CONFIG.physics.rejoinHeightTolerance) return true;
      if (!actor.derailedFromRaisedCrossover) return true;
      return actor.flightTime >= CONFIG.physics.highToLowRejoinMinFlightTime
        && actor.flightVelocity.y <= CONFIG.physics.highToLowRejoinMaxUpVelocity;
    }

    function rejoinTrack(actor, landing) {
      const tangent = landing.tangent.clone();
      tangent.y = 0;
      if (tangent.lengthSq() <= 0.0001) tangent.set(0, 0, -1);
      tangent.normalize();
      const flatVelocity = new THREE.Vector3(actor.flightVelocity.x, 0, actor.flightVelocity.z);
      if (flatVelocity.lengthSq() > 0.0001 && flatVelocity.dot(tangent) < 0) tangent.multiplyScalar(-1);
      const speed = Math.max(flatVelocity.length() * 0.68, CONFIG.physics.flightRejoinSpeed);

      actor.derailed = false;
      actor.derailState = 'none';
      actor.finished = false;
      actor.stopped = false;
      actor.pressure = CONFIG.physics.derailPressure * 0.38;
      actor.lowSpeedTime = 0;
      actor.targetIndex = landing.nextIndex;
      actor.flightVelocity.set(0, 0, 0);
      actor.spinVelocity.set(0, 0, 0);
      actor.flightTime = 0;
      actor.derailedFromRaisedCrossover = false;
      actor.body.position.set(landing.point.x, landing.point.y, landing.point.z);
      actor.body.velocity.set(tangent.x * speed, 0, tangent.z * speed);
      actor.body.force.set(0, 0, 0);
      actor.mesh.rotation.set(0, 0, 0);
      syncCarFromPhysics(actor);
    }

    function updateOffTrackCar(actor, dt) {
      actor.flightVelocity.y = 0;
      const groundSpeed = Math.hypot(actor.flightVelocity.x, actor.flightVelocity.z);
      if (groundSpeed < CONFIG.physics.offTrackCruiseSpeed) {
        const heading = new THREE.Vector3(actor.flightVelocity.x, 0, actor.flightVelocity.z);
        if (heading.lengthSq() <= 0.0001) heading.set(0, 0, -1);
        heading.normalize().multiplyScalar(CONFIG.physics.offTrackCruiseSpeed);
        actor.flightVelocity.x = heading.x;
        actor.flightVelocity.z = heading.z;
      }
      actor.mesh.position.add(actor.flightVelocity.clone().multiplyScalar(dt));
      actor.mesh.position.y = getDerailedGroundY(actor.mesh.position, actor);
      resolveDerailedRailCollision(actor);
      resolveDerailedCarCollisions(actor);
      if (actor.derailState === 'flipping') return;
      actor.speed = actor.flightVelocity.length();
      alignCarToVelocity(actor);
      const limit = CONFIG.gridSize * CONFIG.tile * 0.5 + CONFIG.physics.offTrackDespawnDistance;
      if (Math.abs(actor.mesh.position.x) > limit || Math.abs(actor.mesh.position.z) > limit) {
        actor.mesh.visible = false;
        actor.stopped = true;
        actor.speed = 0;
        actor.flightVelocity.set(0, 0, 0);
        actor.derailState = 'gone';
      }
    }

    function updateWreckedCar(actor, dt) {
      actor.flightVelocity.y = 0;
      actor.flightVelocity.multiplyScalar(Math.pow(CONFIG.physics.wreckFriction, dt * 60));
      actor.mesh.position.add(actor.flightVelocity.clone().multiplyScalar(dt));
      actor.mesh.position.y = getDerailedGroundY(actor.mesh.position, actor);
      resolveDerailedRailCollision(actor);
      resolveDerailedCarCollisions(actor);
      settleCarRotation(actor, true);
      actor.speed = actor.flightVelocity.length();
      if (actor.speed < CONFIG.physics.wreckStopSpeed) {
        actor.stopped = true;
        actor.speed = 0;
        actor.flightVelocity.set(0, 0, 0);
        actor.spinVelocity.set(0, 0, 0);
        actor.derailState = 'settled';
      }
    }

    function alignCarToVelocity(actor) {
      const velocity = new THREE.Vector3(actor.flightVelocity.x, 0, actor.flightVelocity.z);
      if (velocity.lengthSq() <= 0.0001) return;
      const look = actor.mesh.position.clone().add(velocity);
      actor.mesh.lookAt(look.x, actor.mesh.position.y, look.z);
    }

    function syncCarFromPhysics(actor) {
      const guide = getGuideTarget(actor, false);
      let slopeTangent = null;
      if (guide) {
        const flatCurrent = new THREE.Vector3(actor.body.position.x, 0, actor.body.position.z);
        const flatPrev = new THREE.Vector3(guide.prev.pos.x, 0, guide.prev.pos.z);
        const flatNext = new THREE.Vector3(guide.node.pos.x, 0, guide.node.pos.z);
        const projected = closestPointOnSegmentWithT(flatCurrent, flatPrev, flatNext);
        const groundY = THREE.MathUtils.lerp(guide.prev.pos.y, guide.node.pos.y, projected.t);
        actor.body.position.y = THREE.MathUtils.lerp(actor.body.position.y, groundY, 0.55);
        slopeTangent = guide.node.pos.clone().sub(guide.prev.pos);
      }
      actor.mesh.position.set(actor.body.position.x, actor.body.position.y + CONFIG.carVisualYOffset, actor.body.position.z);
      const velocity = new THREE.Vector3(actor.body.velocity.x, 0, actor.body.velocity.z);
      if (slopeTangent && slopeTangent.lengthSq() > 0.0001) {
        const direction = slopeTangent.normalize();
        if (velocity.lengthSq() > 0.0001 && direction.x * velocity.x + direction.z * velocity.z < 0) {
          direction.multiplyScalar(-1);
        }
        const look = actor.mesh.position.clone().add(direction);
        actor.mesh.lookAt(look.x, look.y, look.z);
      } else if (velocity.lengthSq() > 0.0001) {
        const look = actor.mesh.position.clone().add(velocity);
        actor.mesh.lookAt(look.x, actor.mesh.position.y, look.z);
      }
      actor.mesh.rotation.z += Math.sin(performance.now() * 0.05 + actor.index) * 0.004 * actor.pressure;
    }

    function summarizeCars() {
      const activeCars = carActors.filter((actor) => !actor.finished || actor.derailed);
      const cars = activeCars.length > 0 ? activeCars : carActors;
      state.carSpeed = cars.reduce((sum, actor) => sum + actor.speed, 0) / Math.max(cars.length, 1);
      state.carPressure = cars.reduce((max, actor) => Math.max(max, actor.pressure), 0);
      state.carStopped = carActors.every((actor) => actor.stopped);
    }

    function pieceCenter(piece) {
      return new THREE.Vector3(piece.x * CONFIG.tile, driveHeight(piece), piece.z * CONFIG.tile);
    }

    function driveHeight(piece) {
      if (!piece) return CONFIG.trackHeight + 0.03;
      return CONFIG.trackHeight + 0.03;
    }

    function tintGroup(group, color, opacity) {
      group.traverse((child) => {
        if (child.material) {
          child.material.color.setHex(color);
          child.material.opacity = opacity;
        }
      });
    }

    function updateHud() {
      modeText.textContent = state.mode === 'drive' ? '試跑' : state.erase ? '擦除' : '編輯';
      pieceText.textContent = state.erase ? '擦除' : state.tool === 'select' ? '選擇' : PIECES[state.tool].label;
      countText.textContent = `${state.pieces.size} 件`;
      carCountText.textContent = `${state.carCount} 車`;
      laneCountText.textContent = `${state.laneCount} lane`;
    }

    function updateCarInfoWindow() {
      if (!carInfoWindow?.classList.contains('show')) return;
      const actor = carActors[state.selectedCarIndex];
      if (!actor) {
        closeCarInfoWindow();
        return;
      }
      const colorHex = `#${actor.color.toString(16).padStart(6, '0')}`;
      const risk = getDerailRisk(actor);
      const stability = Math.max(0, 100 - risk);
      carInfoTitleText.textContent = actor.name;
      carInfoName.textContent = actor.name;
      carInfoStatus.textContent = getCarStatus(actor);
      carInfoSpeed.textContent = `${actor.speed.toFixed(1)} m/s`;
      carInfoColor.textContent = colorHex.toUpperCase();
      carInfoColorChip.style.background = colorHex;
      carInfoLane.textContent = `${actor.laneIndex + 1} / ${state.laneCount}`;
      carInfoDerailRisk.textContent = `${risk}%`;
      carInfoStability.textContent = `${stability}%`;
      carInfoMotor.textContent = `${actor.params.motorAccel.toFixed(1)} / ${actor.params.maxSpeed.toFixed(1)} m/s`;
    }

    function getCarStatus(actor) {
      if (actor.derailState === 'flying') return '飛出中';
      if (actor.derailState === 'offtrack') return '場外行走';
      if (actor.derailState === 'flipping') return '翻車中';
      if (actor.derailState === 'wrecked') return '反車滑行';
      if (actor.derailState === 'settled') return '反車停止';
      if (actor.derailState === 'gone') return '已離場';
      if (actor.stopped && actor.finished) return '完成';
      if (actor.stopped) return '停止';
      if (state.mode !== 'drive') return '待命';
      return '行駛中';
    }

    function getDerailRisk(actor) {
      if (actor.derailState === 'flying') return 100;
      if (actor.derailState === 'flipping' || actor.derailState === 'wrecked' || actor.derailState === 'settled') return 100;
      if (actor.derailState === 'offtrack' || actor.derailState === 'gone') return 0;
      const pressureRisk = actor.pressure / CONFIG.physics.derailPressure;
      const speedExcess = Math.max(0, actor.speed - CONFIG.physics.curveSafeSpeed);
      const speedRisk = speedExcess / Math.max(1, actor.params.maxSpeed - CONFIG.physics.curveSafeSpeed);
      return THREE.MathUtils.clamp(Math.round(Math.max(pressureRisk, speedRisk * 0.75) * 100), 0, 100);
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(state.messageTimer);
      state.messageTimer = setTimeout(() => toast.classList.remove('show'), 1600);
    }

    function cellKey(x, z) {
      return `${x},${z}`;
    }

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    }

    function updateSelectedOverlay() {
      if (!pieceActions) return;
      if (state.mode !== 'edit' || !state.selectedKey || !state.pieces.has(state.selectedKey)) {
        pieceActions.classList.remove('show');
        return;
      }

      const piece = state.pieces.get(state.selectedKey);
      const anchor = getPieceActionAnchor(piece);
      anchor.project(camera);
      if (anchor.z < -1 || anchor.z > 1) {
        pieceActions.classList.remove('show');
        return;
      }

      const x = (anchor.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-anchor.y * 0.5 + 0.5) * window.innerHeight;
      pieceActions.style.left = `${Math.round(x)}px`;
      pieceActions.style.top = `${Math.round(y)}px`;
      pieceActions.classList.add('show');
    }

    function getPieceActionAnchor(piece) {
      const dir = DIRS[piece.rotation];
      const side = new THREE.Vector2(-dir.y, dir.x);
      const lengthCells = getPieceCellLength(piece.type);
      const centerX = (piece.x + dir.x * (lengthCells - 1) * 0.5) * CONFIG.tile;
      const centerZ = (piece.z + dir.y * (lengthCells - 1) * 0.5) * CONFIG.tile;
      const halfLength = CONFIG.tile * lengthCells * 0.5;
      const halfWidth = getTrackWidth() * 0.5;
      return new THREE.Vector3(
        centerX + dir.x * halfLength * 0.86 + side.x * halfWidth * 0.86,
        0.86,
        centerZ + dir.y * halfLength * 0.86 + side.y * halfWidth * 0.86
      );
    }
