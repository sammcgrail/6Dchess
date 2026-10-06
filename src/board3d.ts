/* Three.js 6D Chess - multiverse with timeline branching */

// THREE.js is loaded from CDN as a global - we just use the types from @types/three
import type {
  Scene, PerspectiveCamera, WebGLRenderer, Raycaster, Vector2, Vector3, Clock,
  Group, Mesh, Sprite, Points, Material, MeshStandardMaterial, SpriteMaterial,
  Texture, Object3D, Curve, BufferGeometry, Color as THREE_Color
} from 'three';

import type {
  Board,
  ChessMove,
  HighlightEntry,
  PieceCharMap,
  TextureCache,
  FocusTween,
  PanKeyState,
  ITimelineCol,
  IBoard3D,
} from './types';

import { stockfish } from './stockfish';

// OrbitControls from CDN is attached to global THREE
interface OrbitControlsInstance {
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  target: Vector3;
  screenSpacePanning: boolean;
  update(): void;
}

// Declare THREE as a global (loaded from CDN)
declare const THREE: typeof import('three') & {
  OrbitControls: new (camera: PerspectiveCamera, domElement: HTMLElement) => OrbitControlsInstance;
};

// ===============================================================
// Module-level constants - accessible to all classes in this file
// ===============================================================

// One SpriteMaterial per piece texture, shared by every sprite showing that piece
const pieceMaterialCache = new Map<Texture, SpriteMaterial>();

// Board coordinate labels are identical on every board, so share them
const labelMaterialCache = new Map<string, SpriteMaterial>();

// Piece slide animations, advanced by Board3DManager's render loop
interface PieceTween {
  sprite: Sprite;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  start: number;
}
const PIECE_SLIDE_MS = 220;
const pieceTweens: PieceTween[] = [];

/** Advance piece slides; returns true while any are running */
function updatePieceTweens(now: number): boolean {
  for (let i = pieceTweens.length - 1; i >= 0; i--) {
    const t = pieceTweens[i];
    const k = Math.min(1, (now - t.start) / PIECE_SLIDE_MS);
    const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
    t.sprite.position.x = t.fromX + (t.toX - t.fromX) * e;
    t.sprite.position.z = t.fromZ + (t.toZ - t.fromZ) * e;
    // Small hop so the piece reads as moving over the board
    t.sprite.position.y = TimelineCol.MAIN_PIECE_Y + Math.sin(Math.PI * e) * 0.25;
    if (k >= 1) pieceTweens.splice(i, 1);
  }
  return pieceTweens.length > 0;
}

const BLACK = new THREE.Color(0x000000);
const LIGHT_SQUARE = new THREE.Color(0x7878ac);
const DARK_SQUARE = new THREE.Color(0x45456f);
const SELECTED_SQUARE = new THREE.Color(0xd4b040);
const CHECKMATE_GLOW = new THREE.Color(0xff3333);
const DRAW_GLOW = new THREE.Color(0xffa500);

/** Free GPU resources of an object tree whose geometries and materials are not shared (e.g. glow tubes) */
function disposeTree(root: Object3D): void {
  root.traverse((obj: Object3D) => {
    const mesh = obj as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

/** Remove and dispose every child of a group */
function clearGroup(group: Group): void {
  while (group.children.length) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    disposeTree(child);
  }
}

/** Set a glow tube's opacity scale; each material remembers its base opacity from _glowTube */
function setTubeOpacity(tube: Object3D, scale: number): void {
  tube.userData.opacityScale = scale;
  tube.traverse((obj: Object3D) => {
    const mat = (obj as Mesh).material as Material | undefined;
    if (mat && mat.userData.baseOpacity !== undefined) {
      mat.opacity = mat.userData.baseOpacity * scale;
    }
  });
}

// ===============================================================
// SharedResources - singleton for shared geometries and materials
// Performance optimization: create once, reuse everywhere
// ===============================================================

class SharedResources {
  private static _instance: SharedResources | null = null;

  // Shared geometries (created once, reused everywhere)
  squareGeometry: InstanceType<typeof THREE.PlaneGeometry> | null = null;
  boardBaseGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;
  boardTrimGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;
  historyBaseGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;
  historyPlaneGeometry: InstanceType<typeof THREE.PlaneGeometry> | null = null;

  // Move indicator geometries
  moveIndicatorCircle: InstanceType<typeof THREE.CircleGeometry> | null = null;
  moveIndicatorRing: InstanceType<typeof THREE.RingGeometry> | null = null;
  lastMoveHighlightGeometry: InstanceType<typeof THREE.PlaneGeometry> | null = null;

  // Cross-timeline indicator geometries
  crossTimelineRingSmall: InstanceType<typeof THREE.RingGeometry> | null = null;
  crossTimelineRingLarge: InstanceType<typeof THREE.RingGeometry> | null = null;
  crossTimelineGlowGeometry: InstanceType<typeof THREE.CircleGeometry> | null = null;

  // Time travel portal geometries
  portalOuterRing: InstanceType<typeof THREE.TorusGeometry> | null = null;
  portalInnerGlow: InstanceType<typeof THREE.CircleGeometry> | null = null;
  portalCaptureRing: InstanceType<typeof THREE.TorusGeometry> | null = null;

  // Shared materials (not cloned - for objects that don't need per-instance color changes)
  boardBaseMat: MeshStandardMaterial | null = null;
  boardTrimMat: MeshStandardMaterial | null = null;
  historyBaseMat: MeshStandardMaterial | null = null;
  moveIndicatorMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  lastMoveHighlightMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  crossTimelineRingMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  crossTimelineGlowMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalRingMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalGlowMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalGlowCaptureMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalCaptureRingMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;

  // Shared history square materials - use clones for per-layer opacity
  // PERFORMANCE: 2 base materials instead of 64+ per layer (768+ for 12 layers)

  static getInstance(): SharedResources {
    if (!SharedResources._instance) {
      SharedResources._instance = new SharedResources();
      SharedResources._instance._init();
    }
    return SharedResources._instance;
  }

  private _init(): void {
    // === Geometries ===
    this.squareGeometry = new THREE.PlaneGeometry(0.96, 0.96);
    this.boardBaseGeometry = new THREE.BoxGeometry(8.6, 0.18, 8.6);
    this.boardTrimGeometry = new THREE.BoxGeometry(8.8, 0.06, 8.8);
    this.historyBaseGeometry = new THREE.BoxGeometry(8.2, 0.03, 8.2);
    this.historyPlaneGeometry = new THREE.PlaneGeometry(8, 8);

    // Move indicators
    this.moveIndicatorCircle = new THREE.CircleGeometry(0.14, 32);
    this.moveIndicatorRing = new THREE.RingGeometry(0.34, 0.44, 32);
    this.lastMoveHighlightGeometry = new THREE.PlaneGeometry(0.96, 0.96);

    // Cross-timeline indicators
    this.crossTimelineRingSmall = new THREE.RingGeometry(0.28, 0.38, 32);
    this.crossTimelineRingLarge = new THREE.RingGeometry(0.38, 0.48, 32);
    this.crossTimelineGlowGeometry = new THREE.CircleGeometry(0.5, 32);

    // Time travel portals
    this.portalOuterRing = new THREE.TorusGeometry(0.42, 0.06, 8, 32);
    this.portalInnerGlow = new THREE.CircleGeometry(0.36, 32);
    this.portalCaptureRing = new THREE.TorusGeometry(0.48, 0.04, 8, 32);

    // === Shared Materials ===
    this.boardBaseMat = new THREE.MeshStandardMaterial({
      color: 0x15152a,
      metalness: 0.7,
      roughness: 0.3,
    });
    this.boardTrimMat = new THREE.MeshStandardMaterial({
      color: 0x333366,
      metalness: 0.9,
      roughness: 0.2,
    });
    this.historyBaseMat = new THREE.MeshStandardMaterial({
      color: 0x15152a,
      transparent: true,
      opacity: 0.25,
      metalness: 0.5,
      roughness: 0.5,
    });

    // History square materials - shared base materials for cloning
    // Using clone() allows per-layer opacity while sharing the base material properties

    this.moveIndicatorMat = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.lastMoveHighlightMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.crossTimelineRingMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.crossTimelineGlowMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.portalRingMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this.portalGlowMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.portalGlowCaptureMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.portalCaptureRingMat = new THREE.MeshBasicMaterial({
      color: 0xff6666,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
  }

  /** Dispose all shared resources (call on game shutdown) */
  dispose(): void {
    this.squareGeometry?.dispose();
    this.boardBaseGeometry?.dispose();
    this.boardTrimGeometry?.dispose();
    this.historyBaseGeometry?.dispose();
    this.historyPlaneGeometry?.dispose();
    this.moveIndicatorCircle?.dispose();
    this.moveIndicatorRing?.dispose();
    this.lastMoveHighlightGeometry?.dispose();
    this.crossTimelineRingSmall?.dispose();
    this.crossTimelineRingLarge?.dispose();
    this.crossTimelineGlowGeometry?.dispose();
    this.portalOuterRing?.dispose();
    this.portalInnerGlow?.dispose();
    this.portalCaptureRing?.dispose();

    this.boardBaseMat?.dispose();
    this.boardTrimMat?.dispose();
    this.historyBaseMat?.dispose();
    this.moveIndicatorMat?.dispose();
    this.lastMoveHighlightMat?.dispose();
    this.crossTimelineRingMat?.dispose();
    this.crossTimelineGlowMat?.dispose();
    this.portalRingMat?.dispose();
    this.portalGlowMat?.dispose();
    this.portalGlowCaptureMat?.dispose();
    this.portalCaptureRingMat?.dispose();

    SharedResources._instance = null;
  }
}

// ===============================================================
// MeshPool - object pooling for frequently created/destroyed objects
// Reduces GC pressure and allocation overhead for 100+ timelines
// ===============================================================

interface PooledMesh extends Mesh {
  _poolType?: string;
}

class MeshPool {
  private pools: Map<string, PooledMesh[]> = new Map();
  private maxPoolSize = 200;  // Allow more pooled objects for 100+ timelines

  /** Get a mesh from the pool or create a new one */
  acquire(
    type: string,
    geometry: BufferGeometry,
    material: Material
  ): PooledMesh {
    const pool = this.pools.get(type);
    if (pool && pool.length > 0) {
      const mesh = pool.pop()!;
      mesh.geometry = geometry;
      mesh.material = material;
      mesh.visible = true;
      return mesh;
    }
    const mesh = new THREE.Mesh(geometry, material) as PooledMesh;
    mesh._poolType = type;
    mesh.frustumCulled = true;  // Enable frustum culling for performance
    return mesh;
  }

  /** Return a mesh to the pool */
  release(mesh: PooledMesh): void {
    const type = mesh._poolType;
    if (!type) return;

    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    mesh.visible = false;

    let pool = this.pools.get(type);
    if (!pool) {
      pool = [];
      this.pools.set(type, pool);
    }
    if (pool.length < this.maxPoolSize) {
      pool.push(mesh);
    }
    // If pool is full, let it be garbage collected (don't dispose shared geometry/material)
  }

  /** Clear all pools */
  clear(): void {
    this.pools.clear();
  }
}

// Global pool instance
const meshPool = new MeshPool();

// ===============================================================
// SpritePool - object pooling for piece sprites
// Reduces GC pressure from destroying/creating 32 sprites per move
// ===============================================================

interface PooledSprite extends Sprite {
  _pooled?: boolean;
}

/** Reuses piece sprites. Materials are shared (see pieceMaterialCache) and never disposed here. */
class SpritePool {
  private pool: PooledSprite[] = [];
  private maxPoolSize = 256;

  acquire(material: SpriteMaterial): PooledSprite {
    const sprite = this.pool.pop() ?? (new THREE.Sprite(material) as PooledSprite);
    sprite._pooled = true;
    sprite.material = material;
    sprite.visible = true;
    return sprite;
  }

  release(sprite: PooledSprite): void {
    // A released sprite may be reused elsewhere; stop any slide still driving it
    for (let i = pieceTweens.length - 1; i >= 0; i--) if (pieceTweens[i].sprite === sprite) pieceTweens.splice(i, 1);
    sprite.parent?.remove(sprite);
    sprite.visible = false;
    if (this.pool.length < this.maxPoolSize) this.pool.push(sprite);
  }

  clear(): void {
    this.pool = [];
  }
}

// Global sprite pool instance
const spritePool = new SpritePool();

// ===============================================================
// TimelineCol - one per timeline
// ===============================================================

export class TimelineCol implements ITimelineCol {
  static readonly LAYER_GAP = 2.8;
  static readonly MAX_LAYERS = 12;
  // Y positions for pieces - main board at 0.22, history at 0.12
  // These MUST be different to prevent visual overlap
  static readonly MAIN_PIECE_Y = 0.22;
  static readonly HISTORY_PIECE_Y = 0.12;
  static readonly PIECE_SCALE_3D = 0.88;
  static readonly PIECE_SCALE_2D = 1.25;
  static readonly HISTORY_TEXTURE_SIZE = 256;
  // Board bounds for piece position validation (8x8 board centered at origin).
  // Pieces are placed at positions col-3.5 (from -3.5 to 3.5), but we use
  // slightly wider bounds (-4 to 4) to account for floating-point tolerance.
  // This excludes file/rank labels which are positioned at +/-4.4.
  private static readonly BOARD_MIN = -4;
  private static readonly BOARD_MAX = 4;

  private scene: Scene;
  private shared: SharedResources;
  id: number;
  xOffset: number;
  private _pieceChars: PieceCharMap;
  private _pieceTex: (char: string, isWhite: boolean) => Texture;

  group: Group;
  private squares!: InstanceType<typeof THREE.InstancedMesh>;
  private squareMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.75 });
  private selectedSquare: number | null = null;
  private highlightMeshes: HighlightEntry[] = [];
  private lastMoveHL: Mesh[] = [];
  historyLayers: Group[] = [];  // Public for branch line rebuilding
  private moveLineGroup: Group;
  interLayerGroup: Group;
  private crossTimelineTargets: Mesh[] = [];  // Purple highlights for cross-timeline moves
  private timeTravelTargets: Mesh[] = [];     // Cyan-green portals for time travel moves
  private drawnBranchIndices: Set<number> = new Set();  // Track which snapshot indices have branches drawn
  private _is2DMode = false;  // Track if 2D mode is active (hide history layers)
  // Per-board clones of the base/trim materials so active/highlight glow affects only this board
  private baseMat: MeshStandardMaterial;
  private trimMat: MeshStandardMaterial;
  private tint: THREE_Color;
  private nameLabel: Sprite | null = null;

  // Performance: track previous board state for diff-based rendering
  // Store as map of "row,col" -> "type,color" to detect what changed
  private _prevBoardState: Map<string, string> = new Map();
  // Map sprite position key to the sprite at that position for efficient updates
  private _spriteMap: Map<string, Sprite> = new Map();

  constructor(
    scene: Scene,
    id: number,
    xOffset: number,
    tintColor: number,
    pieceChars: PieceCharMap,
    pieceTex: (char: string, isWhite: boolean) => Texture
  ) {
    this.scene = scene;
    this.shared = SharedResources.getInstance();
    this.id = id;
    this.xOffset = xOffset;
    this._pieceChars = pieceChars;
    this._pieceTex = pieceTex;

    this.group = new THREE.Group();
    this.group.position.x = xOffset;
    this.baseMat = this.shared.boardBaseMat!.clone();
    this.trimMat = this.shared.boardTrimMat!.clone();
    // Tint the frame with the timeline's color so boards match the sidebar list
    this.tint = new THREE.Color(tintColor);
    this.trimMat.color.lerp(this.tint, 0.55);

    this.moveLineGroup = new THREE.Group();
    this.interLayerGroup = new THREE.Group();
    this.group.add(this.moveLineGroup);
    this.group.add(this.interLayerGroup);

    this._buildBoard();
    this._addNameLabel(id === 0 ? 'Main' : 'Branch ' + id);
    scene.add(this.group);
    this._applyBaseGlow();

    // Log timeline creation with position
  }

  private _fromSq(sq: string): { r: number; c: number } {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
  }

  /**
   * Type guard for checking if an Object3D is a main board piece sprite.
   * Used to identify piece sprites that need cleanup during render(),
   * distinguishing them from history layer sprites and UI elements.
   *
   * Criteria:
   * - Must be a Sprite (has isSprite property)
   * - Y position within 0.01 of MAIN_PIECE_Y (tolerance for floating point)
   * - X/Z within board bounds (excludes file/rank labels positioned at +/-4.4)
   *
   * @param obj - The Object3D to check
   * @returns true if obj is a main board piece sprite, false otherwise
   */
  private _isMainBoardSprite(obj: Object3D): obj is Sprite {
    // Guard against null/undefined
    if (!obj) return false;
    // Check if it's a Sprite
    if (!(obj as Sprite).isSprite) return false;
    // Check Y position tolerance (pieces at MAIN_PIECE_Y vs history at HISTORY_PIECE_Y)
    if (Math.abs(obj.position.y - TimelineCol.MAIN_PIECE_Y) >= 0.01) return false;
    // Check X/Z bounds (pieces from -3.5 to 3.5, labels at +/-4.4)
    const { x, z } = obj.position;
    return x >= TimelineCol.BOARD_MIN && x <= TimelineCol.BOARD_MAX &&
           z >= TimelineCol.BOARD_MIN && z <= TimelineCol.BOARD_MAX;
  }

  private _sqToWorld(sq: string, y?: number): Vector3 {
    const p = this._fromSq(sq);
    return new THREE.Vector3(p.c - 3.5 + this.xOffset, y || 0, p.r - 3.5);
  }

  /* board base + squares */
  private _buildBoard(): void {
    // Base board - using shared geometry and material
    const base = new THREE.Mesh(this.shared.boardBaseGeometry!, this.baseMat);
    base.position.y = -0.16;
    base.receiveShadow = true;
    base.frustumCulled = true;
    this.group.add(base);

    const trim = new THREE.Mesh(this.shared.boardTrimGeometry!, this.trimMat);
    trim.position.y = -0.28;
    trim.frustumCulled = true;
    this.group.add(trim);

    // Squares need per-instance materials for highlighting, but share geometry
    // All 64 squares in one instanced mesh (one draw call); per-square color via instance colors
    const squares = new THREE.InstancedMesh(this.shared.squareGeometry!, this.squareMat, 64);
    const m = new THREE.Matrix4();
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8);
      const c = i % 8;
      m.compose(new THREE.Vector3(c - 3.5, 0.035, r - 3.5), rot, new THREE.Vector3(1, 1, 1));
      squares.setMatrixAt(i, m);
      squares.setColorAt(i, this._squareColor(r, c));
    }
    squares.userData = { timelineId: this.id, turn: -1, isBoardSquares: true };
    this.squares = squares;
    this.group.add(squares);

    this._addLabels();
  }

  /** Floating timeline name above the far edge of the board */
  private _addNameLabel(name: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    const hex = '#' + this.tint.getHexString();
    ctx.font = '600 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = hex;
    ctx.shadowBlur = 18;
    ctx.fillStyle = hex;
    ctx.fillText(name, 256, 50);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(name, 256, 50);
    const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 0.6, -5.1);
    sprite.scale.set(3.2, 0.6, 1);
    this.nameLabel = sprite;
    this.group.add(sprite);
  }

  private _addLabels(): void {
    const files = 'abcdefgh';
    for (let i = 0; i < 8; i++) {
      const f = Board3DManager._labelSprite(files[i]);
      f.position.set(i - 3.5, 0.05, 4.4);
      f.scale.set(0.35, 0.35, 0.35);
      this.group.add(f);
      const rk = Board3DManager._labelSprite(String(8 - i));
      rk.position.set(-4.4, 0.05, i - 3.5);
      rk.scale.set(0.35, 0.35, 0.35);
      this.group.add(rk);
    }
  }

  /** Shared sprite material per piece texture (sprites never change their material per instance) */
  private _pieceMaterial(tex: Texture): SpriteMaterial {
    let mat = pieceMaterialCache.get(tex);
    if (!mat) {
      mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      pieceMaterialCache.set(tex, mat);
    }
    return mat;
  }

  /** Render pieces on the current board, updating only squares whose piece changed */
  render(position: Board): void {
    const next = new Map<string, string>();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = position[r][c];
        if (piece) next.set(`${r},${c}`, `${piece.type},${piece.color}`);
      }
    }

    // Remove sprites whose square is now empty or holds a different piece
    for (const [posKey, sprite] of this._spriteMap) {
      if (next.get(posKey) !== this._prevBoardState.get(posKey)) {
        spritePool.release(sprite as PooledSprite);
        this._spriteMap.delete(posKey);
      }
    }

    // Add sprites for squares without one
    const scale = this._is2DMode ? TimelineCol.PIECE_SCALE_2D : TimelineCol.PIECE_SCALE_3D;
    for (const [posKey] of next) {
      if (this._spriteMap.has(posKey)) continue;
      const [r, c] = posKey.split(',').map(Number);
      const piece = position[r][c]!;
      const isW = piece.color === 'w';
      const chKey = isW ? piece.type.toUpperCase() : piece.type;
      const sprite = spritePool.acquire(this._pieceMaterial(this._pieceTex(this._pieceChars[chKey], isW)));
      sprite.position.set(c - 3.5, TimelineCol.MAIN_PIECE_Y, r - 3.5);
      sprite.scale.set(scale, scale, scale);
      this.group.add(sprite);
      this._spriteMap.set(posKey, sprite);
    }

    this._prevBoardState = next;
  }

  /** Number of piece sprites on the current board (used by tests) */
  pieceSpriteCount(): number {
    let count = 0;
    for (const child of this.group.children) {
      if (this._isMainBoardSprite(child)) count++;
    }
    return count;
  }

  /** Drop all piece sprites and re-render from scratch */
  forceFullRebuild(position: Board): void {
    this._clearPieceSprites();
    this.render(position);
  }

  private _clearPieceSprites(): void {
    for (const sprite of this._spriteMap.values()) {
      spritePool.release(sprite as PooledSprite);
    }
    this._spriteMap.clear();
    this._prevBoardState.clear();
  }

  /* highlight / selection */
  private _squareColor(r: number, c: number): THREE_Color {
    return (r + c) % 2 === 0 ? LIGHT_SQUARE : DARK_SQUARE;
  }

  private _setSquareColor(index: number, color: THREE_Color): void {
    this.squares.setColorAt(index, color);
    this.squares.instanceColor!.needsUpdate = true;
  }

  select(sq: string): void {
    this.clearHighlights();
    const pos = this._fromSq(sq);
    this.selectedSquare = pos.r * 8 + pos.c;
    this._setSquareColor(this.selectedSquare, SELECTED_SQUARE);
  }

  showLegalMoves(moves: ChessMove[], position: Board): void {
    for (let i = 0; i < moves.length; i++) {
      const p = this._fromSq(moves[i].to);
      const hasPiece = position[p.r][p.c] !== null;
      // Use shared geometry and material via object pool
      const geo = hasPiece
        ? this.shared.moveIndicatorRing!
        : this.shared.moveIndicatorCircle!;
      const poolType = hasPiece ? 'moveIndicatorRing' : 'moveIndicatorCircle';
      const ind = meshPool.acquire(poolType, geo, this.shared.moveIndicatorMat!);
      ind.rotation.x = -Math.PI / 2;
      ind.position.set(p.c - 3.5, 0.06, p.r - 3.5);
      this.group.add(ind);
      this.highlightMeshes.push({ type: 'ind', mesh: ind });
    }
  }

  /** Slide the piece now standing on `to` from `from` (call after render) */
  animatePieceMove(from: string, to: string): void {
    const a = this._fromSq(from);
    const b = this._fromSq(to);
    const sprite = this._spriteMap.get(`${b.r},${b.c}`);
    if (!sprite || from === to) return;
    for (let i = pieceTweens.length - 1; i >= 0; i--) if (pieceTweens[i].sprite === sprite) pieceTweens.splice(i, 1);
    pieceTweens.push({ sprite, fromX: a.c - 3.5, fromZ: a.r - 3.5, toX: b.c - 3.5, toZ: b.r - 3.5, start: performance.now() });
    sprite.position.set(a.c - 3.5, TimelineCol.MAIN_PIECE_Y, a.r - 3.5);
  }

  showLastMove(from: string, to: string): void {
    // Return old highlights to pool
    for (let i = 0; i < this.lastMoveHL.length; i++) {
      meshPool.release(this.lastMoveHL[i] as PooledMesh);
    }
    this.lastMoveHL = [];
    const sqs = [from, to];
    for (let i = 0; i < 2; i++) {
      const pos = this._fromSq(sqs[i]);
      // Use shared geometry and material via pool
      const pl = meshPool.acquire(
        'lastMoveHighlight',
        this.shared.lastMoveHighlightGeometry!,
        this.shared.lastMoveHighlightMat!
      );
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(pos.c - 3.5, 0.055, pos.r - 3.5);
      this.group.add(pl);
      this.lastMoveHL.push(pl);
    }
  }

  /** CPU move preview - highlight source piece and show target with portal colors */
  private cpuPreviewMeshes: Mesh[] = [];

  showCpuMovePreview(from: string, to: string, isWhite: boolean, isTimeTravel: boolean = false): void {
    this.clearCpuMovePreview();

    const fromPos = this._fromSq(from);
    const toPos = this._fromSq(to);
    const color = isTimeTravel ? 0x44ffaa : (isWhite ? 0x88ccff : 0xffaa66);  // Cyan for time travel, blue/orange for normal

    // Highlight source square with glowing ring
    const sourceGeo = new THREE.RingGeometry(0.42, 0.52, 32);
    const sourceMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sourceRing = new THREE.Mesh(sourceGeo, sourceMat);
    sourceRing.rotation.x = -Math.PI / 2;
    sourceRing.position.set(fromPos.c - 3.5, 0.12, fromPos.r - 3.5);
    this.group.add(sourceRing);
    this.cpuPreviewMeshes.push(sourceRing);

    // Source glow disc
    const sourceGlowGeo = new THREE.CircleGeometry(0.45, 32);
    const sourceGlowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sourceGlow = new THREE.Mesh(sourceGlowGeo, sourceGlowMat);
    sourceGlow.rotation.x = -Math.PI / 2;
    sourceGlow.position.set(fromPos.c - 3.5, 0.10, fromPos.r - 3.5);
    this.group.add(sourceGlow);
    this.cpuPreviewMeshes.push(sourceGlow);

    // Target indicator (portal-style ring like cross-timeline targets)
    const targetGeo = new THREE.RingGeometry(0.35, 0.48, 32);
    const targetMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const targetRing = new THREE.Mesh(targetGeo, targetMat);
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.set(toPos.c - 3.5, 0.09, toPos.r - 3.5);
    this.group.add(targetRing);
    this.cpuPreviewMeshes.push(targetRing);

    // Target glow
    const targetGlowGeo = new THREE.CircleGeometry(0.45, 32);
    const targetGlowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const targetGlow = new THREE.Mesh(targetGlowGeo, targetGlowMat);
    targetGlow.rotation.x = -Math.PI / 2;
    targetGlow.position.set(toPos.c - 3.5, 0.07, toPos.r - 3.5);
    this.group.add(targetGlow);
    this.cpuPreviewMeshes.push(targetGlow);

    // Preview line connecting source to target
    const fromWorld = new THREE.Vector3(fromPos.c - 3.5, 0.15, fromPos.r - 3.5);
    const toWorld = new THREE.Vector3(toPos.c - 3.5, 0.15, toPos.r - 3.5);
    const previewLine = Board3DManager._glowTube(fromWorld, toWorld, color, 0.02, 0.08, false, 0.6);
    previewLine.userData.isCpuPreview = true;
    this.group.add(previewLine);
    this.cpuPreviewMeshes.push(previewLine as unknown as Mesh);
  }

  clearCpuMovePreview(): void {
    for (const mesh of this.cpuPreviewMeshes) {
      this.group.remove(mesh);
      // Dispose materials and geometry
      if ((mesh as Mesh).geometry) (mesh as Mesh).geometry.dispose();
      if ((mesh as Mesh).material) {
        const mat = (mesh as Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else {
          (mat as Material).dispose();
        }
      }
      // If it's a Group (glow tube), traverse and dispose children
      if ((mesh as unknown as Group).isGroup) {
        (mesh as unknown as Group).traverse((child: Object3D) => {
          if ((child as Mesh).geometry) (child as Mesh).geometry.dispose();
          if ((child as Mesh).material) {
            ((child as Mesh).material as Material).dispose();
          }
        });
      }
    }
    this.cpuPreviewMeshes = [];
  }

  clearHighlights(): void {
    if (this.selectedSquare !== null) {
      this._setSquareColor(this.selectedSquare, this._squareColor(Math.floor(this.selectedSquare / 8), this.selectedSquare % 8));
      this.selectedSquare = null;
    }
    for (const h of this.highlightMeshes) {
      meshPool.release(h.mesh as PooledMesh);
    }
    this.highlightMeshes = [];
  }

  /* Cross-timeline movement indicators - enhanced with vertical beams */
  showCrossTimelineTarget(sq: string, isCapture: boolean): void {
    const pos = this._fromSq(sq);
    // Use shared geometry and material via pool
    const geo = isCapture
      ? this.shared.crossTimelineRingLarge!
      : this.shared.crossTimelineRingSmall!;
    const poolType = isCapture ? 'crossTimelineRingLarge' : 'crossTimelineRingSmall';
    const ind = meshPool.acquire(poolType, geo, this.shared.crossTimelineRingMat!);
    ind.rotation.x = -Math.PI / 2;
    ind.position.set(pos.c - 3.5, 0.08, pos.r - 3.5);
    this.group.add(ind);
    this.crossTimelineTargets.push(ind);

    // Add pulsing glow effect
    const glow = meshPool.acquire(
      'crossTimelineGlow',
      this.shared.crossTimelineGlowGeometry!,
      this.shared.crossTimelineGlowMat!
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.c - 3.5, 0.07, pos.r - 3.5);
    this.group.add(glow);
    this.crossTimelineTargets.push(glow);

    // Vertical beam above square (highly visible portal indicator)
    const beamGeo = new THREE.CylinderGeometry(0.08, 0.15, 1.2, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(pos.c - 3.5, 0.7, pos.r - 3.5);
    this.group.add(beam);
    this.crossTimelineTargets.push(beam);

    // Capture indicator (red-ish outer ring if capturing)
    if (isCapture) {
      const captureRingGeo = new THREE.RingGeometry(0.52, 0.58, 32);
      const captureRingMat = new THREE.MeshBasicMaterial({
        color: 0xff6666,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const captureRing = new THREE.Mesh(captureRingGeo, captureRingMat);
      captureRing.rotation.x = -Math.PI / 2;
      captureRing.position.set(pos.c - 3.5, 0.10, pos.r - 3.5);
      this.group.add(captureRing);
      this.crossTimelineTargets.push(captureRing);
    }
  }

  clearCrossTimelineTargets(): void {
    for (const mesh of this.crossTimelineTargets) {
      // Some meshes are pooled, some are not (beams, capture rings)
      if ((mesh as PooledMesh)._poolType) {
        meshPool.release(mesh as PooledMesh);
      } else {
        this.group.remove(mesh);
        if ((mesh as Mesh).geometry) (mesh as Mesh).geometry.dispose();
        if ((mesh as Mesh).material) ((mesh as Mesh).material as Material).dispose();
      }
    }
    this.crossTimelineTargets = [];
    // Also clear board glow border
    this._clearBoardGlowBorder();
  }

  /** Add a glowing border around the entire board to indicate it's a valid target */
  showBoardGlowBorder(color: number = 0xaa44ff): void {
    this._clearBoardGlowBorder();

    // Create 4 edge beams around the board perimeter
    const halfSize = 4.3;  // Board is ~8.6 wide
    const beamHeight = 0.15;
    const beamWidth = 0.08;

    const edges = [
      { pos: [0, beamHeight, -halfSize], rot: [0, 0, 0], len: halfSize * 2 },  // Front edge
      { pos: [0, beamHeight, halfSize], rot: [0, 0, 0], len: halfSize * 2 },   // Back edge
      { pos: [-halfSize, beamHeight, 0], rot: [0, Math.PI / 2, 0], len: halfSize * 2 }, // Left edge
      { pos: [halfSize, beamHeight, 0], rot: [0, Math.PI / 2, 0], len: halfSize * 2 },  // Right edge
    ];

    for (const edge of edges) {
      const geo = new THREE.BoxGeometry(edge.len, beamWidth, beamWidth);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(edge.pos[0], edge.pos[1], edge.pos[2]);
      beam.rotation.set(edge.rot[0], edge.rot[1], edge.rot[2]);
      beam.userData.isBoardGlowBorder = true;
      this.group.add(beam);
    }

    // Add corner glow spheres
    const corners = [
      [-halfSize, beamHeight, -halfSize],
      [halfSize, beamHeight, -halfSize],
      [-halfSize, beamHeight, halfSize],
      [halfSize, beamHeight, halfSize],
    ];

    for (const corner of corners) {
      const geo = new THREE.SphereGeometry(0.12, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(corner[0], corner[1], corner[2]);
      sphere.userData.isBoardGlowBorder = true;
      this.group.add(sphere);
    }
  }

  /** Clear the board glow border */
  private _clearBoardGlowBorder(): void {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (child.userData.isBoardGlowBorder) {
        this.group.remove(child);
        if ((child as Mesh).geometry) (child as Mesh).geometry.dispose();
        if ((child as Mesh).material) ((child as Mesh).material as Material).dispose();
      }
    }
  }

  /* Time travel target indicators (on history layers) */
  showTimeTravelTarget(turnIndex: number, sq: string, isCapture: boolean): void {
    // turnIndex 0 = most recent history layer, which is at historyLayers[0]
    if (turnIndex < 0 || turnIndex >= this.historyLayers.length) return;

    const layer = this.historyLayers[turnIndex];
    if (!layer) return;

    const pos = this._fromSq(sq);

    // Outer glow ring - use shared geometry via pool
    const outerRing = meshPool.acquire(
      'portalOuterRing',
      this.shared.portalOuterRing!,
      this.shared.portalRingMat!
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.set(pos.c - 3.5, TimelineCol.HISTORY_PIECE_Y, pos.r - 3.5);
    layer.add(outerRing);
    this.timeTravelTargets.push(outerRing);

    // Inner glow disc
    const glowMat = isCapture ? this.shared.portalGlowCaptureMat! : this.shared.portalGlowMat!;
    const glow = meshPool.acquire('portalInnerGlow', this.shared.portalInnerGlow!, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.c - 3.5, 0.11, pos.r - 3.5);
    layer.add(glow);
    this.timeTravelTargets.push(glow);

    // Capture indicator (red-ish outer ring if capturing)
    if (isCapture) {
      const captureRing = meshPool.acquire(
        'portalCaptureRing',
        this.shared.portalCaptureRing!,
        this.shared.portalCaptureRingMat!
      );
      captureRing.rotation.x = -Math.PI / 2;
      captureRing.position.set(pos.c - 3.5, 0.13, pos.r - 3.5);
      layer.add(captureRing);
      this.timeTravelTargets.push(captureRing);
    }
  }

  clearTimeTravelTargets(): void {
    // Return all time travel target meshes to pool
    for (const mesh of this.timeTravelTargets) {
      meshPool.release(mesh as PooledMesh);
    }
    this.timeTravelTargets = [];
  }

  /** Mark a snapshot index as having a branch drawn from it */
  markBranchDrawn(snapshotIndex: number): void {
    this.drawnBranchIndices.add(snapshotIndex);
  }

  /** Check if a snapshot index already has a branch drawn */
  hasBranchDrawn(snapshotIndex: number): boolean {
    return this.drawnBranchIndices.has(snapshotIndex);
  }

  /* persistent move lines on current board - keep only last N to prevent clutter */
  private static MAX_MOVE_LINES = 8;  // Only show last 8 moves on top board

  addMoveLine(fromSq: string, toSq: string, isWhite: boolean): void {
    const a = this._sqToWorld(fromSq, 0.09);
    const b = this._sqToWorld(toSq, 0.09);
    a.x -= this.xOffset;
    b.x -= this.xOffset;
    // Softer, more muted colors and much lower opacity for in-board move lines
    const col = isWhite ? 0x6688bb : 0xbb8866;  // Lighter, desaturated blue/red
    this.moveLineGroup.add(Board3DManager._glowTube(a, b, col, 0.012, 0.04, false, 0.3, true));  // Thinner, less glow, 30% opacity

    // Remove old lines to prevent clutter - keep only last N
    while (this.moveLineGroup.children.length > TimelineCol.MAX_MOVE_LINES) {
      const old = this.moveLineGroup.children[0];
      this.moveLineGroup.remove(old);
      disposeTree(old);
    }
  }

  /* history snapshot */
  addSnapshot(position: Board, moveFrom: string, moveTo: string, isWhite: boolean): void {
    const layerGroup = this._makeHistoryBoard(position);
    Object.assign(layerGroup.userData, { moveFrom, moveTo, isWhite });
    // If in 2D mode, hide the new layer immediately
    if (this._is2DMode) {
      layerGroup.visible = false;
    }
    this.historyLayers.unshift(layerGroup);
    this.group.add(layerGroup);

    while (this.historyLayers.length > TimelineCol.MAX_LAYERS) {
      const old = this.historyLayers.pop()!;
      this._removeHistorySquares(old);
      this.group.remove(old);
    }
    this._layoutLayers();
  }

  /**
   * A history layer is drawn as a single textured plane (squares + pieces painted to a canvas)
   * instead of 64 square meshes and up to 32 sprites, cutting ~95 draw calls per layer to 2.
   */
  private _makeHistoryBoard(position: Board): Group {
    const g = new THREE.Group();

    const base = new THREE.Mesh(this.shared.historyBaseGeometry!, this.shared.historyBaseMat!);
    base.position.y = -0.02;
    g.add(base);

    const texture = this._paintHistoryTexture(position);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.5, depthWrite: false });
    const plane = new THREE.Mesh(this.shared.historyPlaneGeometry!, material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.02;
    plane.userData = { timelineId: this.id, turn: this.historyLayers.length, isHistory: true, isHistoryPlane: true };
    g.add(plane);

    g.userData.plane = plane;
    g.userData.material = material;
    g.userData.texture = texture;
    return g;
  }

  /** Paint a board position (squares and piece glyphs) onto a canvas texture */
  private _paintHistoryTexture(position: Board): Texture {
    const size = TimelineCol.HISTORY_TEXTURE_SIZE;
    const sq = size / 8;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(130,130,190,0.55)' : 'rgba(70,70,120,0.55)';
        ctx.fillRect(c * sq, r * sq, sq, sq);
        const piece = position[r][c];
        if (!piece) continue;
        const isW = piece.color === 'w';
        const glyph = this._pieceTex(this._pieceChars[isW ? piece.type.toUpperCase() : piece.type], isW);
        ctx.drawImage(glyph.image as CanvasImageSource, c * sq + sq * 0.06, r * sq + sq * 0.06, sq * 0.88, sq * 0.88);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  private _removeHistorySquares(layerGroup: Group): void {
    (layerGroup.userData.texture as Texture | undefined)?.dispose();
    (layerGroup.userData.material as Material | undefined)?.dispose();
  }

  private _layoutLayers(): void {
    for (let i = 0; i < this.historyLayers.length; i++) {
      const targetY = -(i + 1) * TimelineCol.LAYER_GAP;
      this.historyLayers[i].position.y = targetY;

      // Calculate snapshot index for this layer (most recent history is layer 0)
      // historyLayers[0] corresponds to the most recent snapshot before current
      const snapshotIndex = this.historyLayers.length - 1 - i;
      const hasBranch = this.drawnBranchIndices.has(snapshotIndex);

      // More prominent grey-out effect: lower base opacity and faster falloff
      // Even lower opacity for layers with branches (already explored)
      const baseOp = hasBranch ? 0.12 : 0.28;
      const op = Math.max(0.04, baseOp - i * 0.035);
      this._setGroupOpacity(this.historyLayers[i], op);

      (this.historyLayers[i].userData.plane as Mesh).userData.turn = i;
    }

    // Rebuild inter-layer lines
    clearGroup(this.interLayerGroup);

    for (let j = 0; j < this.historyLayers.length; j++) {
      const layer = this.historyLayers[j];
      const fromSq = layer.userData.moveFrom as string;
      const toSq = layer.userData.moveTo as string;
      const isW = layer.userData.isWhite as boolean;

      // Skip drawing inter-layer lines for layers that have branches
      // (these are already connected to other timelines)
      const snapshotIndex = this.historyLayers.length - 1 - j;
      if (this.drawnBranchIndices.has(snapshotIndex)) {
        continue;
      }

      const fromY = layer.position.y + 0.1;
      const toY = j === 0 ? 0.1 : this.historyLayers[j - 1].position.y + 0.1;
      const fromW = new THREE.Vector3().copy(this._sqToWorld(fromSq, fromY));
      const toW = new THREE.Vector3().copy(this._sqToWorld(toSq, toY));
      fromW.x -= this.xOffset;
      toW.x -= this.xOffset;
      // Softer, more muted inter-layer lines (same as move lines, but keep time travel visible)
      const lineCol = isW ? 0x88bbdd : 0xddaa77;  // Lighter, desaturated cyan/orange
      this.interLayerGroup.add(Board3DManager._glowTube(fromW, toW, lineCol, 0.018, 0.06, true, 0.4, true));
    }
  }

  private _setGroupOpacity(group: Group, opacity: number): void {
    const material = group.userData.material as Material | undefined;
    // The texture already carries square transparency; scale so the newest layer reads clearly
    if (material) material.opacity = Math.min(1, opacity * 1.9);
  }

  getAllSquareMeshes(): Mesh[] {
    return [this.squares as unknown as Mesh].concat(this.historyLayers.map((layer) => layer.userData.plane as Mesh));
  }

  private _active = false;
  private _highlighted = false;

  setActive(active: boolean): void {
    this._active = active;
    this._applyBaseGlow();
  }

  setHighlighted(highlighted: boolean): void {
    this._highlighted = highlighted;
    this._applyBaseGlow();
  }

  private _applyBaseGlow(): void {
    const glow = this._highlighted ? 0x446688 : this._active ? 0x2a2a5a : 0x000000;
    this.baseMat.emissive.setHex(glow);
    // Active board's frame glows in its timeline color
    this.trimMat.emissive.copy(this.tint).multiplyScalar(this._active ? 0.55 : 0.12);
    if (this.nameLabel) (this.nameLabel.material as SpriteMaterial).opacity = this._active ? 1 : 0.55;
  }

  private _boardGlowState: 'checkmate' | 'draw' | 'none' = 'none';

  /** Set board state glow (checkmate = red, draw = amber/orange, none = clear) */
  setBoardGlow(state: 'checkmate' | 'draw' | 'none'): void {
    if (state === this._boardGlowState) return;
    this._boardGlowState = state;
    const glowColor = state === 'checkmate' ? CHECKMATE_GLOW : state === 'draw' ? DRAW_GLOW : null;

    // Apply glow to all square meshes on the main board
    const glowIntensity = state === 'draw' ? 0.4 : 0.3;  // Slightly stronger for draw
    this.squareMat.emissive.copy(glowColor ?? BLACK);
    this.squareMat.emissiveIntensity = glowColor ? glowIntensity : 0;
  }

  clearAll(): void {
    this._clearPieceSprites();

    // Clear history layers and dispose of their contents
    for (let i = 0; i < this.historyLayers.length; i++) {
      const layer = this.historyLayers[i];
      this._removeHistorySquares(layer);
      this.group.remove(layer);
    }
    this.historyLayers = [];
    this.drawnBranchIndices.clear();  // Clear branch tracking
    clearGroup(this.moveLineGroup);
    clearGroup(this.interLayerGroup);
    this.clearHighlights();

    // Return last move highlights to pool
    for (let i = 0; i < this.lastMoveHL.length; i++) {
      meshPool.release(this.lastMoveHL[i] as PooledMesh);
    }
    this.lastMoveHL = [];

    // Clear cross-timeline and time-travel targets
    this.clearCrossTimelineTargets();
    this.clearTimeTravelTargets();

    // Clear CPU move preview indicators
    this.clearCpuMovePreview();
  }

  destroy(): void {
    this.clearAll();
    this.squareMat.dispose();
    this.squares.dispose();
    this.baseMat.dispose();
    this.trimMat.dispose();
    if (this.nameLabel) {
      (this.nameLabel.material as SpriteMaterial).map?.dispose();
      (this.nameLabel.material as SpriteMaterial).dispose();
    }
    this.scene.remove(this.group);
  }

  /**
   * Set 2D mode visibility for this timeline.
   * In 2D mode, hide history layers and inter-layer lines for cleaner top-down view.
   * Scale up pieces for better visibility in top-down view.
   * Keep: board squares, pieces, move indicators, cross-timeline highlights.
   */
  set2DMode(enabled: boolean): void {
    this._is2DMode = enabled;
    // Toggle visibility of history layers
    for (const layer of this.historyLayers) {
      layer.visible = !enabled;
    }
    // Toggle inter-layer lines (the vertical connectors)
    this.interLayerGroup.visible = !enabled;
    // Keep move line group visible (blue/orange move indicators on board)
    // this.moveLineGroup stays visible

    // In the tight 2D grid the name sits just above the board edge
    if (this.nameLabel) {
      this.nameLabel.position.set(0, 0.6, enabled ? -4.75 : -5.1);
      this.nameLabel.scale.set(enabled ? 2.6 : 3.2, enabled ? 0.49 : 0.6, 1);
    }

    // Larger pieces in the top-down 2D view
    const targetScale = enabled ? TimelineCol.PIECE_SCALE_2D : TimelineCol.PIECE_SCALE_3D;
    for (const sprite of this._spriteMap.values()) {
      sprite.scale.set(targetScale, targetScale, targetScale);
    }
  }
}

// ===============================================================
// Board3D - scene manager, coordinates multiple timelines
// ===============================================================

class Board3DManager implements IBoard3D {
  scene: Scene | null = null;
  camera: PerspectiveCamera | null = null;
  renderer: WebGLRenderer | null = null;
  controls: OrbitControlsInstance | null = null;
  private raycaster: Raycaster | null = null;
  private mouse: Vector2 | null = null;
  private container: HTMLElement | null = null;
  private _clock: Clock | null = null;
  private _downPos: { x: number; y: number } | null = null;
  private _texCache: TextureCache = {};

  // Performance: render-on-demand
  private _needsRender = true;

  // Performance: FPS tracking
  private _frameCount = 0;
  private _lastFpsUpdate = 0;
  private _currentFps = 0;

  // Performance: track camera state to detect OrbitControls changes
  private _lastCameraPosition = new THREE.Vector3();
  private _lastCameraTarget = new THREE.Vector3();

  // Ambient animation is throttled to this interval (seconds) to keep idle cost low
  private static readonly AMBIENT_INTERVAL = 1 / 30;
  private _lastAmbientTime = 0;
  private _reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Performance: pooled scratch vectors (avoid GC churn from frequent allocations)
  // These are reused across frames in _updatePanning() for camera movement calculations.
  //
  // _tempVec3A: forward direction from camera, also reused for rotation offset
  // _tempVec3B: right direction (perpendicular to forward in XZ plane)
  // _tempVec3C: accumulated movement vector
  // _tempVec3D: up reference vector (0,1,0) - MUST be separate from _tempVec3B to avoid
  //             crossVectors() self-reference bug where output === input corrupts calculation
  private _tempVec3A = new THREE.Vector3();
  private _tempVec3B = new THREE.Vector3();
  private _tempVec3C = new THREE.Vector3();
  private _tempVec3D = new THREE.Vector3();

  timelineCols: Record<number, TimelineCol> = {};
  private branchLineGroup: Group | null = null;
  private particleSystem: Points | null = null;

  // Track branch/time-travel line metadata for rebuilding when snapshots shift
  private _branchLineData: Array<{
    type: 'branch' | 'cross' | 'timetravel';
    fromTlId: number;
    toTlId: number;
    fromTurn: number;  // Snapshot count in source timeline at time of creation
    toTurn?: number;   // Snapshot count in target timeline at time of creation
    square?: string;
    targetTurnIndex?: number;  // For time travel: target snapshot index
    isWhite?: boolean;
    createdAt?: number;  // Timestamp for cross-timeline lines (for fade-out animation)
  }> = [];

  // Duration in seconds for cross-timeline lines to fade to minimum opacity
  private static readonly CROSS_LINE_FADE_DURATION = 4.0;
  // Minimum opacity - lines never fully disappear
  private static readonly CROSS_LINE_MIN_OPACITY = 0.35;
  // Track cross-line mesh groups for efficient opacity updates (index matches _branchLineData cross entries)
  private _crossLineMeshes: Array<{ group: Group; createdAt: number; baseOpacity: number }> = [];
  private onSquareClick:
    | ((info: { timelineId: number; square: string; turn: number; isHistory: boolean }) => void)
    | null = null;

  private _panKeys: PanKeyState = { w: false, a: false, s: false, d: false, q: false, e: false };
  private _panSpeed = 0.12;  // Slowed down from 0.25 for smoother control
  private _focusTween: FocusTween | undefined;
  private _resizeTimeout: number | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _lastContainerWidth = 0;
  private _lastContainerHeight = 0;

  // Store bound event handlers for proper cleanup in dispose()
  private _boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private _boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private _boundResize: (() => void) | null = null;
  private _boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _boundBlur: (() => void) | null = null;
  private _boundPageHide: ((e: PageTransitionEvent) => void) | null = null;
  private _boundVisibilityChange: (() => void) | null = null;
  private _boundContextLost: ((e: Event) => void) | null = null;
  private _boundContextRestored: (() => void) | null = null;

  // WebGL context loss state
  private _webglContextLost = false;

  // Animation frame ID for proper cleanup on dispose
  private _animationFrameId: number | null = null;

  // Flag to stop animation loop on dispose
  private _disposed = false;

  // Selected board index for keyboard navigation (null = no specific board selected)
  private _selectedBoardIndex: number | null = null;

  // Zoom state for board focus
  private _zoomedIn = false;
  private _preZoomCameraState: { position: Vector3; target: Vector3 } | null = null;

  // 2D mode state (top-down orthographic view)
  private _is2DMode = false;
  private _pre2DCameraState: { position: Vector3; target: Vector3 } | null = null;
  private _pre2DBoardPositions: Map<number, number> = new Map(); // timeline id -> original xOffset

  // Visual effects storage
  private _activeEffects: Array<{
    mesh: Mesh | Points;
    startTime: number;
    duration: number;
    type: 'portal' | 'capture';
  }> = [];

  // WHITE pieces: use outlined symbols (♔♕♖♗♘♙)
  // BLACK pieces: use FILLED symbols (♚♛♜♝♞♟) + VS15 to force text rendering
  // VS15 (U+FE0E) prevents emoji rendering on iOS
  readonly PIECE_CHARS: PieceCharMap = {
    K: '\u2654',  // ♔ WHITE CHESS KING (outlined)
    Q: '\u2655',  // ♕ WHITE CHESS QUEEN
    R: '\u2656',  // ♖ WHITE CHESS ROOK
    B: '\u2657',  // ♗ WHITE CHESS BISHOP
    N: '\u2658',  // ♘ WHITE CHESS KNIGHT
    P: '\u2659',  // ♙ WHITE CHESS PAWN
    k: '\u265A\uFE0E',  // ♚ BLACK CHESS KING + VS15 (text presentation)
    q: '\u265B\uFE0E',  // ♛ BLACK CHESS QUEEN + VS15
    r: '\u265C\uFE0E',  // ♜ BLACK CHESS ROOK + VS15
    b: '\u265D\uFE0E',  // ♝ BLACK CHESS BISHOP + VS15
    n: '\u265E\uFE0E',  // ♞ BLACK CHESS KNIGHT + VS15
    p: '\u265F\uFE0E',  // ♟ BLACK CHESS PAWN + VS15
  };

  readonly TIMELINE_COLORS: number[] = [
    0x44ddff, 0xff66aa, 0x66ff88, 0xffaa33, 0xaa66ff, 0xff4444, 0x44ffcc, 0xffff44,
  ];
  readonly TIMELINE_SPACING = 12;

  /** Screen position (CSS px, relative to the canvas) of a square's center; used by e2e tests */
  squareToScreen(timelineId: number, square: string, turn = -1): { x: number; y: number } | null {
    const col = this.timelineCols[timelineId];
    if (!col || !this.camera || !this.renderer) return null;
    const c = square.charCodeAt(0) - 97;
    const r = 8 - Number(square[1]);
    const layerY = turn < 0 ? 0.035 : col.historyLayers[turn]?.position.y ?? 0;
    const v = new THREE.Vector3(col.group.position.x + c - 3.5, layerY + (turn < 0 ? 0 : 0.02), col.group.position.z + r - 3.5);
    v.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Mark that a render is needed (called when state changes) */
  markDirty(): void {
    this._needsRender = true;
  }

  /** Get current FPS */
  getFps(): number {
    return this._currentFps;
  }

  init(
    containerId: string,
    onSquareClick: (info: { timelineId: number; square: string; turn: number; isHistory: boolean }) => void
  ): void {
    this.onSquareClick = onSquareClick;
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element '${containerId}' not found`);
    }
    this.container = container;
    this._clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Initialize shared resources singleton
    SharedResources.getInstance();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(0x080818);
    this.container.appendChild(this.renderer.domElement);

    // WebGL context loss handling - prevents white screen crashes
    this._boundContextLost = (event: Event) => {
      event.preventDefault();  // Allows context to be restored
      this._webglContextLost = true;
      console.error('[Board3D] WebGL context lost! Render loop paused.');
      // Show user-friendly error message
      const overlay = document.createElement('div');
      overlay.id = 'webgl-context-lost-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);color:white;display:flex;align-items:center;justify-content:center;font-size:18px;z-index:1000;';
      overlay.textContent = 'WebGL context lost. Please refresh the page.';
      this.container?.appendChild(overlay);
    };
    this._boundContextRestored = () => {
      this._webglContextLost = false;
      console.log('[Board3D] WebGL context restored.');
      // Remove error overlay
      const overlay = document.getElementById('webgl-context-lost-overlay');
      overlay?.remove();
      // Mark for render
      this._needsRender = true;
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this._boundContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this._boundContextRestored);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080818, 0.008);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 300);
    this.camera.position.set(0, 14, 12);

    // Use global THREE.OrbitControls from CDN
    const controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 5;
    controls.maxDistance = 200;  // Increased from 80 to support viewing all 10 boards
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.target.set(0, 0, 0);
    controls.screenSpacePanning = true;
    this.controls = controls;

    this._setupLights();
    this.branchLineGroup = new THREE.Group();
    this.scene.add(this.branchLineGroup);
    this._createFloor();
    this._createParticles();

    // Store bound event handlers for cleanup in dispose()
    this._boundPointerDown = (e: PointerEvent) => {
      this._downPos = { x: e.clientX, y: e.clientY };
    };
    this._boundPointerUp = (e: PointerEvent) => {
      if (!this._downPos) return;
      const dx = e.clientX - this._downPos.x;
      const dy = e.clientY - this._downPos.y;
      if (dx * dx + dy * dy < 36) this._onClick(e);
      this._downPos = null;
    };
    this._boundResize = () => this._scheduleResize();
    this._boundKeyDown = (e: KeyboardEvent) => this._onKeyDown(e);
    this._boundKeyUp = (e: KeyboardEvent) => this._onKeyUp(e);

    // Fast cleanup handlers for tab close/navigation
    // Use pagehide instead of beforeunload to avoid blocking tab close
    this._boundPageHide = (e: PageTransitionEvent) => {
      // If not persisted (bfcache), dispose immediately
      if (!e.persisted) {
        this._disposed = true;
        if (this._animationFrameId !== null) {
          cancelAnimationFrame(this._animationFrameId);
          this._animationFrameId = null;
        }
        // Terminate stockfish worker to avoid hanging the tab
        stockfish.terminate();
      }
    };

    // Pause animation when tab is hidden to save resources
    this._boundVisibilityChange = () => {
      if (document.hidden) {
        // Stop animation loop while hidden
        this._disposed = true;
        if (this._animationFrameId !== null) {
          cancelAnimationFrame(this._animationFrameId);
          this._animationFrameId = null;
        }
      } else if (this._disposed && !document.hidden) {
        // Resume animation loop when tab becomes visible again
        this._disposed = false;
        this._animate();
      }
    };

    this.renderer.domElement.addEventListener('pointerdown', this._boundPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this._boundPointerUp);

    // Window resize handler with debouncing
    window.addEventListener('resize', this._boundResize);

    // ResizeObserver for container size changes (handles sidebar resize, etc.)
    this._resizeObserver = new ResizeObserver(this._boundResize);
    this._resizeObserver.observe(this.container);

    // Store initial dimensions
    this._lastContainerWidth = this.container.clientWidth;
    this._lastContainerHeight = this.container.clientHeight;

    // WASD keyboard panning
    window.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('keyup', this._boundKeyUp);
    // Keyups are lost when the window loses focus mid-press; release all pan keys
    this._boundBlur = () => {
      this._panKeys = { w: false, a: false, s: false, d: false, q: false, e: false };
    };
    window.addEventListener('blur', this._boundBlur);

    // Tab close/navigation cleanup - use pagehide for fast, non-blocking cleanup
    window.addEventListener('pagehide', this._boundPageHide);

    // Pause/resume when tab visibility changes (saves resources)
    document.addEventListener('visibilitychange', this._boundVisibilityChange);

    // Ensure initial render happens after all setup is complete
    this._needsRender = true;

    this._animate();
  }

  /* create / get timeline */
  createTimeline(id: number, xOffset: number): TimelineCol {
    const col = new TimelineCol(
      this.scene!,
      id,
      xOffset,
      this.TIMELINE_COLORS[id % this.TIMELINE_COLORS.length],
      this.PIECE_CHARS,
      this._pieceTexture.bind(this)
    );
    this.timelineCols[id] = col;
    return col;
  }

  getTimeline(id: number): TimelineCol | undefined {
    return this.timelineCols[id];
  }

  /** Clear CPU move previews on ALL timelines */
  clearAllCpuPreviews(): void {
    for (const key in this.timelineCols) {
      this.timelineCols[key].clearCpuMovePreview();
    }
  }

  removeTimeline(id: number): void {
    if (this.timelineCols[id]) {
      this.timelineCols[id].destroy();
      delete this.timelineCols[id];
    }
  }

  /* add a glow branch line between two timelines */
  addBranchLine(fromTlId: number, fromTurn: number, toTlId: number): void {
    const fromCol = this.timelineCols[fromTlId];
    const toCol = this.timelineCols[toTlId];
    if (!fromCol || !toCol || !this.branchLineGroup) return;

    // Skip if this branch point has already been drawn
    const branchKey = fromTurn;
    if (fromCol.hasBranchDrawn(branchKey)) {
      return;
    }
    fromCol.markBranchDrawn(branchKey);

    // Store metadata for rebuilding when snapshots shift
    this._branchLineData.push({
      type: 'branch',
      fromTlId,
      toTlId,
      fromTurn,
    });

    this._rebuildBranchLines();
  }

  /** Add a horizontal line showing cross-timeline piece movement */
  addCrossTimelineLine(fromTlId: number, toTlId: number, square: string, isWhite: boolean): void {
    const fromCol = this.timelineCols[fromTlId];
    const toCol = this.timelineCols[toTlId];
    if (!fromCol || !toCol || !this.branchLineGroup) return;

    // Store metadata for rebuilding when snapshots shift
    // Track both timelines' snapshot counts so lines step down correctly on each
    this._branchLineData.push({
      type: 'cross',
      fromTlId,
      toTlId,
      fromTurn: fromCol.historyLayers.length,
      toTurn: toCol.historyLayers.length,
      square,
      isWhite,
      createdAt: this._clock?.getElapsedTime() ?? 0,
    });

    this._rebuildBranchLines();
  }

  /** Add a time travel line showing queen moving backward in time to create new timeline */
  addTimeTravelLine(
    sourceTlId: number,
    targetTurnIndex: number,
    newTlId: number,
    square: string,
    isWhite: boolean
  ): void {
    const sourceCol = this.timelineCols[sourceTlId];
    const newCol = this.timelineCols[newTlId];
    if (!sourceCol || !newCol || !this.branchLineGroup) return;

    // Store metadata for rebuilding when snapshots shift
    // fromTurn = snapshot count on source at time of travel
    // toTurn = snapshot count on new timeline at time of travel (for stepping down)
    this._branchLineData.push({
      type: 'timetravel',
      fromTlId: sourceTlId,
      toTlId: newTlId,
      fromTurn: sourceCol.historyLayers.length,
      toTurn: newCol.historyLayers.length,
      targetTurnIndex,
      square,
      isWhite,
    });

    this._rebuildBranchLines();
  }

  private _fromSq(sq: string): { r: number; c: number } {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
  }

  /** Rebuild all branch/cross/time-travel lines based on stored metadata */
  private _rebuildBranchLines(): void {
    if (!this.branchLineGroup) return;

    clearGroup(this.branchLineGroup);
    this._crossLineMeshes = [];

    // Drop lines whose endpoints have both scrolled past the visible history stack
    const maxDepth = TimelineCol.MAX_LAYERS;
    this._branchLineData = this._branchLineData.filter((data) => {
      const fromCol = this.timelineCols[data.fromTlId];
      const toCol = this.timelineCols[data.toTlId];
      if (!fromCol || !toCol) return false;
      if (data.type === 'branch') return true;
      const fromDepth = fromCol.historyLayers.length - data.fromTurn;
      const toDepth = toCol.historyLayers.length - (data.toTurn ?? 0);
      return fromDepth <= maxDepth || toDepth <= maxDepth;
    });

    for (const data of this._branchLineData) {
      const fromCol = this.timelineCols[data.fromTlId];
      const toCol = this.timelineCols[data.toTlId];
      if (!fromCol || !toCol) continue;

      if (data.type === 'branch') {
        // Branch line: from history layer to new timeline's top board
        // Calculate depth based on how many snapshots have been added since branch
        const currentDepth = fromCol.historyLayers.length;
        const depthSinceBranch = currentDepth - data.fromTurn;
        const fromY = -(depthSinceBranch + 1) * TimelineCol.LAYER_GAP;

        const from = new THREE.Vector3(fromCol.xOffset, fromY + 0.2, 0);
        const to = new THREE.Vector3(toCol.xOffset, 0.2, 0);
        const tintCol = this.TIMELINE_COLORS[data.toTlId % this.TIMELINE_COLORS.length];

        // Fade based on depth
        const opacityScale = Math.max(0.2, 1 - depthSinceBranch * 0.08);
        this.branchLineGroup.add(Board3DManager._glowTube(from, to, tintCol, 0.04, 0.18, true, opacityScale));

      } else if (data.type === 'cross' && data.square) {
        // Cross-timeline: horizontal line connecting the move positions on both timelines
        const pos = this._fromSq(data.square);
        const sqX = pos.c - 3.5;
        const sqZ = pos.r - 3.5;

        // Calculate depth on SOURCE timeline since cross move
        const fromCurrentDepth = fromCol.historyLayers.length;
        const depthSinceCrossFrom = fromCurrentDepth - data.fromTurn;

        // Calculate depth on TARGET timeline since cross move
        const toCurrentDepth = toCol.historyLayers.length;
        const depthSinceCrossTo = toCurrentDepth - (data.toTurn ?? data.fromTurn);

        // Source Y: steps down as more moves happen on source timeline
        let fromY = 0.3;  // Current board
        if (depthSinceCrossFrom > 0) {
          fromY = -(depthSinceCrossFrom) * TimelineCol.LAYER_GAP + 0.2;
        }

        // Target Y: steps down as more moves happen on target timeline
        let toY = 0.3;
        if (depthSinceCrossTo > 0) {
          toY = -(depthSinceCrossTo) * TimelineCol.LAYER_GAP + 0.2;
        }

        const from = new THREE.Vector3(fromCol.xOffset + sqX, fromY, sqZ);
        const to = new THREE.Vector3(toCol.xOffset + sqX, toY, sqZ);

        const color = 0xaa44ff;  // Purple
        const avgDepth = (depthSinceCrossFrom + depthSinceCrossTo) / 2;
        const depthOpacity = Math.max(0.2, 1 - avgDepth * 0.08);

        // Fresh cross-timeline lines start bright and settle to a minimum opacity
        const currentTime = this._clock?.getElapsedTime() ?? 0;
        const createdAt = data.createdAt ?? currentTime;
        const opacityScale = depthOpacity * this._crossLineFade(currentTime - createdAt);

        const tubeGroup = Board3DManager._glowTube(from, to, color, 0.03, 0.12, true, opacityScale);
        this.branchLineGroup.add(tubeGroup);
        this._crossLineMeshes.push({ group: tubeGroup, createdAt, baseOpacity: depthOpacity });

      } else if (data.type === 'timetravel' && data.square !== undefined && data.targetTurnIndex !== undefined) {
        // Time travel: vertical line down then horizontal to new timeline
        const pos = this._fromSq(data.square);
        const sqX = pos.c - 3.5;
        const sqZ = pos.r - 3.5;

        // Calculate how many snapshots have been added on SOURCE timeline since time travel
        const fromCurrentDepth = fromCol.historyLayers.length;
        const depthSinceTravelFrom = fromCurrentDepth - data.fromTurn;

        // Calculate how many snapshots have been added on NEW timeline since creation
        const toCurrentDepth = toCol.historyLayers.length;
        const depthSinceTravelTo = toCurrentDepth - (data.toTurn ?? 0);

        // Start Y: departure point on source timeline steps down as moves happen
        let startY = 0.3;  // Current board
        if (depthSinceTravelFrom > 0) {
          startY = -(depthSinceTravelFrom) * TimelineCol.LAYER_GAP + 0.2;
        }

        // Mid Y: the historical target point on source timeline
        // This also needs to step down as new snapshots are added
        const adjustedTargetIndex = data.targetTurnIndex + depthSinceTravelFrom + 1;
        const midY = -(adjustedTargetIndex + 1) * TimelineCol.LAYER_GAP + 0.2;

        // End Y: arrival point on new timeline steps down as that timeline gets more moves
        let endY = 0.3;
        if (depthSinceTravelTo > 0) {
          endY = -(depthSinceTravelTo) * TimelineCol.LAYER_GAP + 0.2;
        }

        const start = new THREE.Vector3(fromCol.xOffset + sqX, startY, sqZ);
        const mid = new THREE.Vector3(fromCol.xOffset + sqX, midY, sqZ);
        const end = new THREE.Vector3(toCol.xOffset + sqX, endY, sqZ);

        const color = 0x44ffaa;  // Cyan-green
        const avgDepth = (depthSinceTravelFrom + depthSinceTravelTo) / 2;
        const opacityScale = Math.max(0.2, 1 - avgDepth * 0.08);

        // Vertical line down through time
        this.branchLineGroup.add(Board3DManager._glowTube(start, mid, color, 0.03, 0.12, false, opacityScale));

        // Horizontal line to new timeline
        this.branchLineGroup.add(Board3DManager._glowTube(mid, end, color, 0.03, 0.12, true, opacityScale));
      }
    }
  }

  /** Connection-line metadata, for saving/restoring a game */
  exportLines(): unknown[] {
    return this._branchLineData.map((d) => ({ ...d }));
  }

  /** Restore connection lines saved with exportLines(); restored lines appear already settled */
  importLines(lines: unknown[]): void {
    const now = this._clock?.getElapsedTime() ?? 0;
    this._branchLineData = (lines as typeof this._branchLineData).map((d) =>
      d.type === 'cross' ? { ...d, createdAt: now - Board3DManager.CROSS_LINE_FADE_DURATION - 1 } : { ...d }
    );
    this._rebuildBranchLines();
    this._needsRender = true;
  }

  /** Notify that a timeline's snapshots have changed - triggers branch line rebuild */
  notifySnapshotAdded(timelineId: number): void {
    // Rebuild branch lines whenever any timeline gets a new snapshot
    // This ensures lines stay connected to the correct history layers
    this._rebuildBranchLines();
  }

  /** Time-based fade factor for cross-timeline lines (1 when new, settling at a minimum) */
  private _crossLineFade(elapsed: number): number {
    return Math.max(Board3DManager.CROSS_LINE_MIN_OPACITY, 1 - elapsed / Board3DManager.CROSS_LINE_FADE_DURATION);
  }

  setActiveTimeline(id: number): void {
    for (const key in this.timelineCols) {
      this.timelineCols[key].setActive(parseInt(key) === id);
    }
  }

  /* Smoothly pan camera to center on a timeline */
  focusTimeline(id: number, animate: boolean): void {
    const col = this.timelineCols[id];
    if (!col || !this.controls || !this.camera || !this._clock) return;
    // The 2D grid already shows every board; panning would push it off screen
    if (this._is2DMode) return;

    const targetX = col.xOffset;
    const currentTarget = this.controls.target.clone();
    const newTarget = new THREE.Vector3(targetX, 0, 0);

    if (animate) {
      const startTime = this._clock.getElapsedTime();
      const duration = 0.4;

      this._focusTween = {
        start: currentTarget,
        end: newTarget,
        startTime,
        duration,
      };
    } else {
      const delta = new THREE.Vector3().subVectors(newTarget, currentTarget);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
  }

  /* Update focus animation in render loop */
  private _updateFocusAnimation(): void {
    if (!this._focusTween || !this._clock || !this.controls || !this.camera) return;

    const t = this._clock.getElapsedTime();
    const elapsed = t - this._focusTween.startTime;
    const progress = Math.min(elapsed / this._focusTween.duration, 1);

    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);

    const newTarget = this._tempVec3A.lerpVectors(this._focusTween.start, this._focusTween.end, eased);
    const delta = this._tempVec3B.subVectors(newTarget, this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);

    if (progress >= 1) {
      this._focusTween = undefined;
    }
  }

  /* Lights */
  private _setupLights(): void {
    if (!this.scene) return;
    this.scene.add(new THREE.AmbientLight(0x404060, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(5, 15, 8);
    this.scene.add(dir);
    const p1 = new THREE.PointLight(0x4466ff, 0.5, 50);
    p1.position.set(-12, 8, -8);
    this.scene.add(p1);
    const p2 = new THREE.PointLight(0xff6644, 0.35, 50);
    p2.position.set(12, 8, 8);
    this.scene.add(p2);
  }

  private _createFloor(): void {
    // Removed grid floor that was causing visual artifacts between boards
    // The dark background is sufficient for the cosmic aesthetic
  }

  private _createParticles(): void {
    if (!this.scene) return;
    const n = 400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = Math.random() * 30 - 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particleSystem = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x6688cc,
        size: 0.07,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.particleSystem);
  }

  /* piece texture factory - MAXIMUM DISTINCTION between white and black */
  private _pieceTexture(symbol: string, isWhite: boolean): Texture {
    const key = symbol + (isWhite ? 'w' : 'b');
    if (this._texCache[key]) return this._texCache[key];
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = s;
    cv.height = s;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, s, s);
    ctx.font = `bold ${s * 0.82}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (isWhite) {
      // WHITE pieces: bright cream/ivory with dark outline
      // Warm glow
      ctx.shadowColor = 'rgba(255,240,200,0.6)';
      ctx.shadowBlur = 12;
      // Dark outline for contrast
      ctx.strokeStyle = '#1a1510';
      ctx.lineWidth = 10;
      ctx.strokeText(symbol, s / 2, s / 2);
      ctx.lineWidth = 6;
      ctx.strokeText(symbol, s / 2, s / 2);
      // Bright cream fill
      ctx.fillStyle = '#fffef5';
      ctx.fillText(symbol, s / 2, s / 2);
      ctx.shadowBlur = 0;
    } else {
      // BLACK pieces: filled symbols (♚♛♜♝♞♟) with VS15 to force text rendering
      // These are naturally solid/filled, just need cyan outline
      // Cyan outline first (underneath)
      ctx.strokeStyle = '#00dddd';
      ctx.lineWidth = 8;
      ctx.strokeText(symbol, s / 2, s / 2);
      ctx.lineWidth = 5;
      ctx.strokeText(symbol, s / 2, s / 2);
      // Then fill with solid black
      ctx.fillStyle = '#0a0a0a';
      ctx.fillText(symbol, s / 2, s / 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    this._texCache[key] = tex;
    return tex;
  }

  /* board coordinate label sprite (texture/material shared across all boards) */
  static _labelSprite(text: string): Sprite {
    let mat = labelMaterialCache.get(text);
    if (!mat) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.font = '600 44px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#8a8ac0';
      ctx.fillText(text, 32, 34);
      mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
      labelMaterialCache.set(text, mat);
    }
    return new THREE.Sprite(mat);
  }

  /* glow tube (static helper) */
  /**
   * Glowing line between two points. `lite` tubes (small in-board connectors) use just a soft
   * glow and a core; full tubes add a mid glow layer and end caps.
   */
  static _glowTube(
    from: Vector3,
    to: Vector3,
    color: number,
    coreR: number,
    glowR: number,
    arc: boolean,
    opacityScale: number = 1.0,
    lite = false
  ): Group {
    const group = new THREE.Group();
    let curve: Curve<Vector3>;
    if (arc) {
      const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
      // Lift the arc above boards so it doesn't clip through them
      const dist = from.distanceTo(to);
      const yLift = Math.max(1.5, dist * 0.25);
      mid.y = Math.max(from.y, to.y) + yLift;
      // Perpendicular nudge so parallel lines don't overlap
      const hDir = new THREE.Vector2(to.x - from.x, to.z - from.z);
      if (hDir.length() > 0.01) {
        hDir.normalize();
        mid.x += -hDir.y * 0.5;
        mid.z += hDir.x * 0.5;
      }
      curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    } else {
      curve = new THREE.LineCurve3(from, to);
    }
    const segs = arc ? (lite ? 16 : 24) : 1;
    const radial = lite ? 6 : 8;
    const glowMat = (opacity: number, white = false) =>
      new THREE.MeshBasicMaterial({
        color: white ? 0xffffff : color,
        transparent: true,
        opacity: opacity * opacityScale,
        blending: THREE.AdditiveBlending,
        side: white ? THREE.FrontSide : THREE.DoubleSide,
        depthWrite: false,
      });

    // Outer glow first: the ambient pulse animates children[0]
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, glowR, radial, false), glowMat(0.1)));
    if (!lite) {
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, glowR * 0.45, radial, false), glowMat(0.22)));
    }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, coreR, radial, false), glowMat(0.75, true)));

    if (!lite) {
      const capGeo = new THREE.SphereGeometry(coreR * 2.2, 10, 8);
      for (const p of [from, to]) {
        const cap = new THREE.Mesh(capGeo.clone(), glowMat(0.6));
        cap.position.copy(p);
        group.add(cap);
      }
      capGeo.dispose();
    }

    // Remember unscaled opacities so fades can rescale without compounding
    group.traverse((obj: Object3D) => {
      const mat = (obj as Mesh).material as Material | undefined;
      if (mat) mat.userData.baseOpacity = opacityScale > 0 ? mat.opacity / opacityScale : 0;
    });
    group.userData.opacityScale = opacityScale;
    return group;
  }

  /* WASD keyboard panning handlers */
  private _onKeyDown(e: KeyboardEvent): void {
    // Don't capture if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const key = e.key.toLowerCase() as keyof PanKeyState;
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      e.preventDefault();
      this._panKeys[key] = true;
    }

    // Debug key: 'p' to log all timeline positions
    if (e.key.toLowerCase() === 'p' && e.shiftKey) {
      this._debugLogAllTimelinePositions();
    }
  }

  /** Debug helper: Log all timeline positions to console */
  private _debugLogAllTimelinePositions(): void {
    const positions = Object.values(this.timelineCols).map(col => ({
      id: col.id,
      xOffset: col.xOffset,
      groupX: col.group.position.x,
    }));

    // Sort by xOffset for clarity
    positions.sort((a, b) => a.xOffset - b.xOffset);

    console.table(positions);

    // Check for duplicates
    const offsets = positions.map(p => p.xOffset);
    const duplicates = offsets.filter((v, i) => offsets.indexOf(v) !== i);
    if (duplicates.length > 0) {
      console.error('[DUPLICATE_POSITIONS] Found timelines at same xOffset!', duplicates);
    } else {
    }

  }

  private _onKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase() as keyof PanKeyState;
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      this._panKeys[key] = false;
    }
  }

  private _updatePanning(): boolean {
    if (!this._panKeys || !this.camera || !this.controls) return false;

    let panX = 0;
    let panZ = 0;
    if (this._panKeys.w) panZ -= this._panSpeed;
    if (this._panKeys.s) panZ += this._panSpeed;
    if (this._panKeys.a) panX -= this._panSpeed;
    if (this._panKeys.d) panX += this._panSpeed;

    let isPanning = false;

    if (panX !== 0 || panZ !== 0) {
      isPanning = true;
      // Use pooled vectors to avoid GC churn
      const forward = this._tempVec3A;
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      // CRITICAL FIX: Use separate 'up' vector for crossVectors() to avoid self-reference bug.
      //
      // The BUGGY code was:
      //   right.set(0, 1, 0);
      //   right.crossVectors(forward, right).normalize();
      //
      // This fails because crossVectors(a, b) computes:
      //   this.x = a.y * b.z - a.z * b.y
      //   this.y = a.z * b.x - a.x * b.z
      //   this.z = a.x * b.y - a.y * b.x
      //
      // When 'this' === 'b', the first assignment corrupts b.x before it's used
      // in the subsequent calculations, producing incorrect results.
      //
      // Solution: Use a separate vector for the 'up' reference.
      const up = this._tempVec3D;
      up.set(0, 1, 0);
      const right = this._tempVec3B;
      right.crossVectors(forward, up).normalize();

      // Calculate movement using pooled vector
      const move = this._tempVec3C;
      move.set(0, 0, 0);
      move.addScaledVector(forward, -panZ);
      move.addScaledVector(right, panX);

      // Apply to both camera and target
      this.camera.position.add(move);
      this.controls.target.add(move);
    }

    // Q/E keyboard rotation (slow orbit around target)
    if (this._panKeys.q || this._panKeys.e) {
      isPanning = true;
      const rotateDir = this._panKeys.q ? 1 : -1; // Q = rotate left, E = rotate right
      const rotateSpeed = 0.015; // Slow rotation

      // Use pooled vector for offset
      const offset = this._tempVec3A;
      offset.subVectors(this.camera.position, this.controls.target);

      // Rotate around Y axis
      const angle = rotateDir * rotateSpeed;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const newX = offset.x * cos - offset.z * sin;
      const newZ = offset.x * sin + offset.z * cos;

      offset.x = newX;
      offset.z = newZ;

      // Apply new position
      this.camera.position.copy(this.controls.target).add(offset);
    }

    return isPanning;
  }

  /* click -> find which timeline + square (or history square) */
  private _onClick(event: PointerEvent): void {
    if (!this.renderer || !this.raycaster || !this.mouse || !this.camera) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    // Objects added since the last frame (e.g. a new history layer) have stale world matrices
    this.scene?.updateMatrixWorld();

    // Collect all clickable squares across all timelines
    let allMeshes: Mesh[] = [];
    for (const key in this.timelineCols) {
      allMeshes = allMeshes.concat(this.timelineCols[key].getAllSquareMeshes());
    }
    const isShown = (obj: Object3D | null): boolean => {
      for (let o = obj; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    const hit = this.raycaster.intersectObjects(allMeshes).find((h) => isShown(h.object));
    if (hit && this.onSquareClick) {
      const ud = hit.object.userData;
      if (ud.isBoardSquares && hit.instanceId !== undefined) {
        this.onSquareClick({
          timelineId: ud.timelineId as number,
          square: String.fromCharCode(97 + (hit.instanceId % 8)) + (8 - Math.floor(hit.instanceId / 8)),
          turn: -1,
          isHistory: false,
        });
        return;
      }
      if (ud.isHistoryPlane && hit.uv) {
        const c = Math.min(7, Math.floor(hit.uv.x * 8));
        const r = Math.min(7, Math.floor((1 - hit.uv.y) * 8));
        this.onSquareClick({
          timelineId: ud.timelineId as number,
          square: String.fromCharCode(97 + c) + (8 - r),
          turn: ud.turn as number,
          isHistory: true,
        });
        return;
      }
      this.onSquareClick({
        timelineId: ud.timelineId as number,
        square: ud.square as string,
        turn: ud.turn as number,
        isHistory: !!ud.isHistory,
      });
    }
  }

  /** Schedule a debounced resize to prevent rapid re-renders */
  private _scheduleResize(): void {
    if (this._resizeTimeout !== null) {
      window.clearTimeout(this._resizeTimeout);
    }
    this._resizeTimeout = window.setTimeout(() => {
      this._onResize();
      this._resizeTimeout = null;
    }, 50);
  }

  private _onResize(): void {
    if (!this.container || !this.camera || !this.renderer) return;

    // Get container dimensions with fallback to parent or window
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;

    // Ensure we have valid dimensions (prevent 0-size canvas)
    if (w <= 0 || h <= 0) {
      const parent = this.container.parentElement;
      if (parent) {
        w = parent.clientWidth - 250; // Account for sidebar
        h = parent.clientHeight;
      }
      // Final fallback to window dimensions
      if (w <= 0) w = window.innerWidth - 250;
      if (h <= 0) h = window.innerHeight;
    }

    // Clamp dimensions to reasonable bounds
    w = Math.max(100, Math.min(w, window.innerWidth));
    h = Math.max(100, Math.min(h, window.innerHeight));

    // Only resize if dimensions actually changed
    if (w === this._lastContainerWidth && h === this._lastContainerHeight) {
      return;
    }

    this._lastContainerWidth = w;
    this._lastContainerHeight = h;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private _animate(): void {
    // Check if disposed - stop animation loop
    if (this._disposed) return;

    this._animationFrameId = requestAnimationFrame(() => this._animate());

    // Skip rendering if WebGL context is lost
    if (this._webglContextLost) return;

    if (!this._clock || !this.controls || !this.renderer || !this.scene || !this.camera) return;

    const t = this._clock.getElapsedTime();

    // FPS tracking
    this._frameCount++;
    if (t - this._lastFpsUpdate >= 1.0) {
      this._currentFps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsUpdate = t;
      this._updateFpsDisplay();
    }

    // Update WASD panning (marks dirty if moving)
    const wasPanning = this._updatePanning();
    if (wasPanning) this._needsRender = true;

    // Update focus animation
    if (this._focusTween) {
      this._updateFocusAnimation();
      this._needsRender = true;
    }

    // Update visual effects
    if (pieceTweens.length > 0) {
      updatePieceTweens(performance.now());
      this._needsRender = true;
    }

    if (this._activeEffects.length > 0) {
      this._updateEffects();
      this._needsRender = true;
    }

    // Controls damping requires constant updates
    this.controls.update();

    // Detect OrbitControls camera movement (mouse drag, zoom, etc.)
    if (!this.camera.position.equals(this._lastCameraPosition) ||
        !this.controls.target.equals(this._lastCameraTarget)) {
      this._needsRender = true;
      this._lastCameraPosition.copy(this.camera.position);
      this._lastCameraTarget.copy(this.controls.target);
    }

    // Ambient motion (starfield drift, glow pulse) runs at a capped rate so an idle
    // scene costs a fraction of a full-rate render loop
    if (!this._reducedMotion && t - this._lastAmbientTime >= Board3DManager.AMBIENT_INTERVAL) {
      this._lastAmbientTime = t;
      if (this.particleSystem) {
        this.particleSystem.rotation.y = t * 0.006;
        this.particleSystem.position.y = Math.sin(t * 0.15) * 0.4;
      }
      // Pulse the soft outer glow of inter-timeline lines
      const pulse = 0.75 + 0.25 * Math.sin(t * 2);
      for (const tube of this.branchLineGroup?.children ?? []) {
        const outer = tube.children[0] as Mesh | undefined;
        const mat = outer?.material as Material | undefined;
        if (mat) mat.opacity = mat.userData.baseOpacity * (tube.userData.opacityScale ?? 1) * pulse;
      }
      this._needsRender = true;
    }

    // Cross-timeline lines fade out after they appear (only while still fading)
    if (this._crossLineMeshes.length > 0) {
      let fading = false;
      for (const entry of this._crossLineMeshes) {
        const elapsed = t - entry.createdAt;
        if (elapsed > Board3DManager.CROSS_LINE_FADE_DURATION + 0.1) continue;
        fading = true;
        setTubeOpacity(entry.group, entry.baseOpacity * this._crossLineFade(elapsed));
      }
      if (fading) this._needsRender = true;
    }

    // PERFORMANCE: Only render when dirty flag is set
    // This can save significant GPU/CPU when the scene is static
    if (this._needsRender) {
      this.renderer.render(this.scene, this.camera);
      this._needsRender = false;
    }
  }

  /** Update FPS display in UI */
  private _updateFpsDisplay(): void {
    const fpsEl = document.getElementById('fps-counter');
    if (fpsEl) {
      fpsEl.textContent = `${this._currentFps} FPS`;
    }
  }

  /** Create portal effect at a position (cyan-purple burst) */
  spawnPortalEffect(timelineId: number, square: string): void {
    if (!this.scene || !this._clock) return;
    const col = this.timelineCols[timelineId];
    if (!col) return;

    const pos = this._squareToWorld(col.xOffset, square);

    // Create a ring of particles expanding outward
    const geo = new THREE.RingGeometry(0.1, 0.5, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ffcc,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(pos.x, 0.3, pos.z);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);

    this._activeEffects.push({
      mesh: ring,
      startTime: this._clock.getElapsedTime(),
      duration: 0.5,
      type: 'portal',
    });
  }

  /** Create capture effect at a position (red flash) */
  spawnCaptureEffect(timelineId: number, square: string): void {
    if (!this.scene || !this._clock) return;
    const col = this.timelineCols[timelineId];
    if (!col) return;

    const pos = this._squareToWorld(col.xOffset, square);

    // Create a flash sphere
    const geo = new THREE.SphereGeometry(0.3, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.8,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(pos.x, 0.4, pos.z);
    this.scene.add(sphere);

    this._activeEffects.push({
      mesh: sphere,
      startTime: this._clock.getElapsedTime(),
      duration: 0.3,
      type: 'capture',
    });
  }

  /** Convert square notation to world position */
  private _squareToWorld(xOffset: number, square: string): { x: number; z: number } {
    const c = square.charCodeAt(0) - 97; // a=0, h=7
    const r = 8 - parseInt(square[1]);   // 8=0, 1=7
    return {
      x: xOffset + c - 3.5,
      z: r - 3.5,
    };
  }

  /** Update visual effects (called in animate loop) */
  private _updateEffects(): void {
    if (!this._clock || !this.scene) return;
    const t = this._clock.getElapsedTime();

    for (let i = this._activeEffects.length - 1; i >= 0; i--) {
      const eff = this._activeEffects[i];
      const elapsed = t - eff.startTime;
      const progress = elapsed / eff.duration;

      if (progress >= 1) {
        // Remove finished effect
        this.scene.remove(eff.mesh);
        eff.mesh.geometry?.dispose();
        if (eff.mesh.material) {
          if (Array.isArray(eff.mesh.material)) {
            eff.mesh.material.forEach(m => m.dispose());
          } else {
            (eff.mesh.material as Material).dispose();
          }
        }
        this._activeEffects.splice(i, 1);
        continue;
      }

      // Animate based on type
      if (eff.type === 'portal') {
        // Expand ring outward and fade
        const scale = 1 + progress * 2;
        eff.mesh.scale.set(scale, scale, 1);
        ((eff.mesh as Mesh).material as MeshStandardMaterial).opacity = 0.9 * (1 - progress);
      } else if (eff.type === 'capture') {
        // Expand sphere and fade quickly
        const scale = 1 + progress * 1.5;
        eff.mesh.scale.set(scale, scale, scale);
        ((eff.mesh as Mesh).material as MeshStandardMaterial).opacity = 0.8 * (1 - progress);
      }
    }
  }

  clearAll(): void {
    for (const key in this.timelineCols) {
      this.timelineCols[key].destroy();
    }
    this.timelineCols = {};
    if (this.branchLineGroup) clearGroup(this.branchLineGroup);
    // Clear branch line metadata and cross-line mesh tracking
    this._branchLineData = [];
    this._crossLineMeshes = [];
    this.controls?.target.set(0, 0, 0);
    // Clear object pools when resetting game
    meshPool.clear();
  }

  /**
   * Comprehensive cleanup method for tab close / page unload.
   * Disposes all Three.js resources to prevent memory leaks and GPU context issues.
   * Call this on beforeunload event or when destroying the game instance.
   */
  dispose(): void {

    // Set disposed flag to stop animation loop
    this._disposed = true;

    // Cancel any pending animation frame
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }

    // Terminate stockfish worker
    stockfish.terminate();

    // Clear all timelines first
    this.clearAll();

    // Dispose particle system
    if (this.particleSystem) {
      this.particleSystem.geometry?.dispose();
      if (this.particleSystem.material) {
        (this.particleSystem.material as Material).dispose();
      }
      this.scene?.remove(this.particleSystem);
      this.particleSystem = null;
    }

    // Dispose branch line group and its contents
    if (this.branchLineGroup && this.scene) {
      this.branchLineGroup.traverse((child: Object3D) => {
        const mesh = child as Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(m => m.dispose());
            } else {
              (mesh.material as Material).dispose();
            }
          }
        }
      });
      this.scene.remove(this.branchLineGroup);
      this.branchLineGroup = null;
    }

    // Dispose active effects
    for (const eff of this._activeEffects) {
      eff.mesh.geometry?.dispose();
      if (eff.mesh.material) {
        if (Array.isArray(eff.mesh.material)) {
          eff.mesh.material.forEach(m => m.dispose());
        } else {
          (eff.mesh.material as Material).dispose();
        }
      }
      this.scene?.remove(eff.mesh);
    }
    this._activeEffects = [];

    // Dispose shared materials

    // Dispose texture cache
    for (const key in this._texCache) {
      this._texCache[key]?.dispose();
    }
    this._texCache = {};

    // Dispose SharedResources singleton
    SharedResources.getInstance().dispose();

    // Clear mesh pool
    meshPool.clear();

    // Disconnect resize observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Clear resize timeout
    if (this._resizeTimeout !== null) {
      window.clearTimeout(this._resizeTimeout);
      this._resizeTimeout = null;
    }

    // Remove event listeners using stored bound handlers
    if (this._boundResize) {
      window.removeEventListener('resize', this._boundResize);
    }
    if (this._boundKeyDown) {
      window.removeEventListener('keydown', this._boundKeyDown);
    }
    if (this._boundKeyUp) {
      window.removeEventListener('keyup', this._boundKeyUp);
    }
    if (this._boundPageHide) {
      window.removeEventListener('pagehide', this._boundPageHide);
    }
    if (this._boundVisibilityChange) {
      document.removeEventListener('visibilitychange', this._boundVisibilityChange);
    }
    // Remove WebGL context loss handlers
    if (this.renderer?.domElement) {
      if (this._boundContextLost) {
        this.renderer.domElement.removeEventListener('webglcontextlost', this._boundContextLost);
      }
      if (this._boundContextRestored) {
        this.renderer.domElement.removeEventListener('webglcontextrestored', this._boundContextRestored);
      }
    }
    // Canvas event listeners - removed when canvas is removed from DOM
    // No need to explicitly remove if renderer.domElement is removed

    this._boundPointerDown = null;
    this._boundPointerUp = null;
    this._boundResize = null;
    this._boundKeyDown = null;
    this._boundKeyUp = null;
    this._boundPageHide = null;
    this._boundVisibilityChange = null;
    this._boundContextLost = null;
    this._boundContextRestored = null;

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      if (this.container && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    // Clear sprite pool entirely on dispose
    spritePool.clear();

    // Clear references
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.raycaster = null;
    this.mouse = null;
    this.container = null;
    this._clock = null;
    this.onSquareClick = null;

  }

  /**
   * Select a specific board by index (0-9) for keyboard navigation.
   * @param index - Board index (0 = first timeline, 1 = second, etc.)
   */
  selectBoard(index: number): void {
    const timelineIds = Object.keys(this.timelineCols).map(k => parseInt(k)).sort((a, b) => {
      const aX = this.timelineCols[a]?.xOffset ?? 0;
      const bX = this.timelineCols[b]?.xOffset ?? 0;
      return aX - bX;  // Sort by X position (left to right)
    });

    if (index < 0 || index >= timelineIds.length) {
      return;
    }

    this._selectedBoardIndex = index;
    const timelineId = timelineIds[index];

    // Highlight the selected board visually
    this.setActiveTimeline(timelineId);

    // Pan camera to selected board
    this.focusTimeline(timelineId, true);

    this._needsRender = true;
  }

  /**
   * Cycle to the next/previous board.
   * @param direction - 1 for next, -1 for previous
   */
  cycleBoard(direction: 1 | -1): void {
    const timelineIds = Object.keys(this.timelineCols).map(k => parseInt(k)).sort((a, b) => {
      const aX = this.timelineCols[a]?.xOffset ?? 0;
      const bX = this.timelineCols[b]?.xOffset ?? 0;
      return aX - bX;
    });

    if (timelineIds.length === 0) return;

    let newIndex: number;
    if (this._selectedBoardIndex === null) {
      newIndex = direction === 1 ? 0 : timelineIds.length - 1;
    } else {
      newIndex = this._selectedBoardIndex + direction;
      // Wrap around
      if (newIndex < 0) newIndex = timelineIds.length - 1;
      if (newIndex >= timelineIds.length) newIndex = 0;
    }

    this.selectBoard(newIndex);
  }

  /**
   * Zoom in on the currently selected board.
   */
  zoomInOnSelected(): void {
    if (this._selectedBoardIndex === null) {
      return;
    }

    const timelineIds = Object.keys(this.timelineCols).map(k => parseInt(k)).sort((a, b) => {
      const aX = this.timelineCols[a]?.xOffset ?? 0;
      const bX = this.timelineCols[b]?.xOffset ?? 0;
      return aX - bX;
    });

    if (this._selectedBoardIndex >= timelineIds.length) return;

    const timelineId = timelineIds[this._selectedBoardIndex];
    const col = this.timelineCols[timelineId];
    if (!col || !this.camera || !this.controls) return;

    // Save current camera state for zoom out
    if (!this._zoomedIn) {
      this._preZoomCameraState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };
    }

    // Zoom in close to the board
    const targetX = col.xOffset;
    this.controls.target.set(targetX, 0, 0);
    this.camera.position.set(targetX, 8, 8);  // Close-up view

    this._zoomedIn = true;
    this._needsRender = true;
  }

  /**
   * Zoom out to show all boards (or restore previous camera position).
   */
  zoomOut(): void {
    if (!this.camera || !this.controls) return;

    if (this._preZoomCameraState) {
      // Restore previous camera state
      this.camera.position.copy(this._preZoomCameraState.position);
      this.controls.target.copy(this._preZoomCameraState.target);
      this._preZoomCameraState = null;
    } else {
      // Default: zoom out to see all boards
      const timelineIds = Object.keys(this.timelineCols).map(k => parseInt(k));
      if (timelineIds.length === 0) return;

      // Calculate center and extent of all boards
      let minX = Infinity, maxX = -Infinity;
      for (const id of timelineIds) {
        const x = this.timelineCols[id]?.xOffset ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }

      const centerX = (minX + maxX) / 2;
      const extent = maxX - minX;
      // Position camera to see all boards with some padding
      const distance = Math.max(30, extent * 0.8 + 15);

      this.controls.target.set(centerX, 0, 0);
      this.camera.position.set(centerX, distance * 0.8, distance * 0.6);
    }

    this._zoomedIn = false;
    this._needsRender = true;
  }

  /**
   * Toggle zoom: if zoomed in, zoom out; if zoomed out, zoom in on selected.
   */
  toggleZoom(): void {
    if (this._zoomedIn) {
      this.zoomOut();
    } else {
      this.zoomInOnSelected();
    }
  }

  /**
   * Get the number of visible timelines.
   */
  getTimelineCount(): number {
    return Object.keys(this.timelineCols).length;
  }

  /**
   * Get the currently selected board index.
   */
  getSelectedBoardIndex(): number | null {
    return this._selectedBoardIndex;
  }

  /**
   * Toggle 2D mode (top-down orthographic view).
   */
  toggle2DMode(): void {
    this.set2DMode(!this._is2DMode);
  }

  /**
   * Set 2D mode on or off.
   * In 2D mode, camera looks directly down at boards arranged in a grid layout.
   */
  set2DMode(enabled: boolean): void {
    if (!this.camera || !this.controls) return;
    if (this._is2DMode === enabled) return;
    this._focusTween = undefined;

    if (enabled) {
      // Save current camera state
      this._pre2DCameraState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };

      const timelineIds = Object.keys(this.timelineCols).map(k => parseInt(k));
      if (timelineIds.length === 0) return;

      // Save original positions and rearrange into grid
      this._pre2DBoardPositions.clear();
      const boardSize = 8;
      const gridSpacing = 9; // Tight spacing for 2D grid (just 1 unit gap between boards)
      const rowSpacing = 10; // Extra room between rows for the board name labels
      const numBoards = timelineIds.length;

      // Calculate grid dimensions (prefer wider grids)
      const cols = Math.ceil(Math.sqrt(numBoards * 1.5)); // Slightly wider than square
      const rows = Math.ceil(numBoards / cols);

      // Grid dimensions
      const gridWidth = (cols - 1) * gridSpacing;
      const gridDepth = (rows - 1) * rowSpacing;

      // Sort timelines by original xOffset for consistent ordering
      const sortedIds = timelineIds.sort((a, b) => {
        const aX = this.timelineCols[a]?.xOffset ?? 0;
        const bX = this.timelineCols[b]?.xOffset ?? 0;
        return aX - bX;
      });

      // Position each board in grid
      sortedIds.forEach((id, index) => {
        const col = this.timelineCols[id];
        if (!col) return;

        // Save original position
        this._pre2DBoardPositions.set(id, col.xOffset);

        // Calculate grid position
        const gridCol = index % cols;
        const gridRow = Math.floor(index / cols);

        // Center the grid
        const newX = gridCol * gridSpacing - gridWidth / 2;
        const newZ = gridRow * rowSpacing - gridDepth / 2;

        // Update position
        col.xOffset = newX;
        col.group.position.x = newX;
        col.group.position.z = newZ;
      });

      // Calculate camera position to see all boards
      const aspect = (this.container?.clientWidth ?? 1) / (this.container?.clientHeight ?? 1);
      const fov = 50 * (Math.PI / 180);
      const halfFov = fov / 2;

      // Calculate height needed to see the grid
      const viewWidth = gridWidth + boardSize + 4;
      const viewDepth = gridDepth + boardSize + 4;
      const heightForWidth = (viewWidth / 2) / Math.tan(halfFov) / aspect;
      const heightForDepth = (viewDepth / 2) / Math.tan(halfFov);
      const height = Math.max(heightForWidth, heightForDepth, 25);

      // Position camera above center
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(0, height, 0.1);

      // Restrict polar angle to near-vertical
      this.controls.maxPolarAngle = 0.05;

      // Hide 2D-irrelevant elements on all timelines
      for (const id in this.timelineCols) {
        this.timelineCols[id].set2DMode(true);
      }
      // Hide branch lines
      if (this.branchLineGroup) {
        this.branchLineGroup.visible = false;
      }

      this._is2DMode = true;
    } else {
      // Restore board positions
      for (const [id, originalX] of this._pre2DBoardPositions) {
        const col = this.timelineCols[id];
        if (col) {
          col.xOffset = originalX;
          col.group.position.x = originalX;
          col.group.position.z = 0; // Reset Z back to 0
        }
      }
      this._pre2DBoardPositions.clear();

      // Restore previous camera state
      if (this._pre2DCameraState) {
        this.camera.position.copy(this._pre2DCameraState.position);
        this.controls.target.copy(this._pre2DCameraState.target);
        this._pre2DCameraState = null;
      } else {
        // Default 3D view
        this.camera.position.set(0, 14, 12);
        this.controls.target.set(0, 0, 0);
      }

      // Re-enable rotation
      this.controls.maxPolarAngle = Math.PI * 0.85;

      // Show all elements again
      for (const id in this.timelineCols) {
        this.timelineCols[id].set2DMode(false);
      }
      if (this.branchLineGroup) {
        this.branchLineGroup.visible = true;
      }

      this._is2DMode = false;
    }

    this._needsRender = true;
  }

  /**
   * Check if 2D mode is currently active.
   */
  is2DMode(): boolean {
    return this._is2DMode;
  }

  /**
   * Zoom out to show all boards (for game end or manual view).
   * Similar to zoomOut() but doesn't restore previous camera state.
   */
  zoomOutShowAll(): void {
    if (!this.camera || !this.controls) return;

    const timelineIds = Object.keys(this.timelineCols).map(k => parseInt(k));
    if (timelineIds.length === 0) return;

    // Calculate center and extent of all boards
    let minX = Infinity, maxX = -Infinity;
    for (const id of timelineIds) {
      const x = this.timelineCols[id]?.xOffset ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    // Fit the row of boards (each ~9 units wide, history stacks hanging below) into the
    // camera's horizontal field of view, viewed from the default elevated angle
    const centerX = (minX + maxX) / 2;
    const halfWidth = (maxX - minX) / 2 + 6;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = Math.max(22, (halfWidth / Math.tan(hFov / 2)) * 1.05);
    const dir = new THREE.Vector3(0, 0.75, 0.66).normalize();

    this._focusTween = undefined;  // an in-flight focus animation would drag the view back
    this.controls.target.set(centerX, -3, 0);
    this.camera.position.set(centerX + dir.x * distance, -3 + dir.y * distance, dir.z * distance);

    this._zoomedIn = false;
    this._needsRender = true;
  }
}

// Export singleton instance
export const Board3D = new Board3DManager();
