/* 6D Chess - multiverse game controller with timeline branching */

import { Board3D } from './board3d';
import {
  getTimelineDebugInfo,
  logGameState,
  type BoardDebugInfo,
  type GameDebugState,
} from './gameUtils';
import type {
  Board,
  Piece,
  PieceType,
  PieceColor,
  Move,
  ChessMove,
  ChessInstance,
  TimelineData,
  AnySnapshot,
  Snapshot,
  PendingPromotion,
  SquareClickInfo,
  CrossTimelineMoveTarget,
  CrossTimelineSelection,
  TimeTravelTarget,
  TimeTravelSelection,
  Square,
} from './types';
import {
  canCrossTimelines,
  canTimeTravel,
  crossTimelineLandingSquares,
  pieceMap,
  planCrossTimelineMove,
  planTimeTravel,
  scoreMultiverseMove,
} from './rules';
import { stockfish } from './stockfish';

class GameManager {
  private timelines: Record<number, TimelineData> = {};
  private activeTimelineId = 0;
  private nextTimelineId = 1;
  private selected: string | null = null;
  private selectedTimelineId: number | null = null;
  private pendingPromotion: PendingPromotion | null = null;
  private viewingMoveIndex: number | null = null;

  // Cross-timeline movement state
  private crossTimelineSelection: CrossTimelineSelection | null = null;

  // Time travel movement state (queen moving backward in time)
  private timeTravelSelection: TimeTravelSelection | null = null;

  // Cached state for optimized re-renders (avoid unnecessary DOM updates)
  private _lastMoveListHtml = '';
  private _lastTimelineStructure = '';


  init(): void {
    Board3D.init('scene-container', (info) => this.handleClick(info));

    const resetBtn = document.getElementById('reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.reset());
    }

    // Setup CPU controls
    this._setupCpuControls();

    // Setup keyboard navigation
    this._setupKeyboardNav();

    // Setup move slider
    this._setupMoveSlider();

    // Setup command input for programmatic testing
    this._setupCommandInput();

    // Setup sidebar resize
    this._setupSidebarResize();

    // Setup timeline panel resize and collapse
    this._setupTimelinePanel();

    // Create the main timeline
    this._createTimeline(0, 0, null, -1, null);
    this.setActiveTimeline(0);
    this.renderTimeline(0);
    this.updateStatus();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();

    // Setup example play button
    this._setupExamplePlay();

    // Register callback to update UI when Stockfish becomes ready
    stockfish.onReady(() => {
      this._updateCpuUI();
    });

    // Initial CPU UI update (will show loading state if not ready)
    this._updateCpuUI();
  }

  /* -- Example Play (Demo Mode) -- */
  private _examplePlaying = false;
  private _exampleTimer: number | null = null;

  private _setupExamplePlay(): void {
    const btn = document.getElementById('example-play');
    if (btn) {
      btn.addEventListener('click', () => this._toggleExamplePlay());
    }
  }

  private _toggleExamplePlay(): void {
    if (this._examplePlaying) {
      this._stopExamplePlay();
    } else {
      this._startExamplePlay();
    }
  }

  private _startExamplePlay(): void {
    // Reset first
    this.reset();
    this._examplePlaying = true;

    const btn = document.getElementById('example-play');
    if (btn) {
      btn.classList.add('running');
      btn.textContent = '⏹ Stop';
    }

    // The Immortal Game - Anderssen vs Kieseritzky, London 1851
    // One of the most famous chess games ever played, showcasing brilliant sacrifices
    // Anderssen sacrifices both rooks, his bishop, and his queen to deliver checkmate!
    const demoMoves: Array<{
      type: 'move' | 'timetravel' | 'crossTimeline';
      from?: string;
      to?: string;
      timeline?: number;
      targetTurn?: number;
      targetTimeline?: number;
    }> = [
      { type: 'move', from: 'e2', to: 'e4' },     // 1. e4
      { type: 'move', from: 'e7', to: 'e5' },     // 1... e5
      { type: 'move', from: 'f2', to: 'f4' },     // 2. f4 (King's Gambit)
      { type: 'move', from: 'e5', to: 'f4' },     // 2... exf4
      { type: 'move', from: 'f1', to: 'c4' },     // 3. Bc4
      { type: 'move', from: 'd8', to: 'h4' },     // 3... Qh4+ (check!)
      { type: 'move', from: 'e1', to: 'f1' },     // 4. Kf1
      { type: 'move', from: 'b7', to: 'b5' },     // 4... b5?! (Bryan Countergambit)
      { type: 'move', from: 'c4', to: 'b5' },     // 5. Bxb5
      { type: 'move', from: 'g8', to: 'f6' },     // 5... Nf6
      { type: 'move', from: 'g1', to: 'f3' },     // 6. Nf3
      { type: 'move', from: 'h4', to: 'h6' },     // 6... Qh6
      { type: 'move', from: 'd2', to: 'd3' },     // 7. d3
      { type: 'move', from: 'f6', to: 'h5' },     // 7... Nh5
      { type: 'move', from: 'f3', to: 'h4' },     // 8. Nh4
      { type: 'move', from: 'h6', to: 'g5' },     // 8... Qg5
      { type: 'move', from: 'h4', to: 'f5' },     // 9. Nf5
      { type: 'move', from: 'c7', to: 'c6' },     // 9... c6
      { type: 'move', from: 'g2', to: 'g4' },     // 10. g4!
      { type: 'move', from: 'h5', to: 'f6' },     // 10... Nf6
      { type: 'move', from: 'h1', to: 'g1' },     // 11. Rg1!
      { type: 'move', from: 'c6', to: 'b5' },     // 11... cxb5
      { type: 'move', from: 'h2', to: 'h4' },     // 12. h4!
      { type: 'move', from: 'g5', to: 'g6' },     // 12... Qg6
      { type: 'move', from: 'h4', to: 'h5' },     // 13. h5
      { type: 'move', from: 'g6', to: 'g5' },     // 13... Qg5
      { type: 'move', from: 'd1', to: 'f3' },     // 14. Qf3
      { type: 'move', from: 'f6', to: 'g8' },     // 14... Ng8
      { type: 'move', from: 'c1', to: 'f4' },     // 15. Bxf4
      { type: 'move', from: 'g5', to: 'f6' },     // 15... Qf6
      { type: 'move', from: 'b1', to: 'c3' },     // 16. Nc3
      { type: 'move', from: 'f8', to: 'c5' },     // 16... Bc5
      { type: 'move', from: 'c3', to: 'd5' },     // 17. Nd5!
      { type: 'move', from: 'f6', to: 'b2' },     // 17... Qxb2 (takes rook's pawn)
      { type: 'move', from: 'f4', to: 'd6' },     // 18. Bd6!! (sacrifices rook a1)
      { type: 'move', from: 'c5', to: 'g1' },     // 18... Bxg1 (takes rook!)
      { type: 'move', from: 'e4', to: 'e5' },     // 19. e5!! (another sacrifice)
      { type: 'move', from: 'b2', to: 'a1' },     // 19... Qxa1+ (takes other rook!)
      { type: 'move', from: 'f1', to: 'e2' },     // 20. Ke2
      { type: 'move', from: 'b8', to: 'a6' },     // 20... Na6
      { type: 'move', from: 'f5', to: 'g7' },     // 21. Nxg7+
      { type: 'move', from: 'e8', to: 'd8' },     // 21... Kd8
      { type: 'move', from: 'f3', to: 'f6' },     // 22. Qf6+!! (queen sacrifice!)
      { type: 'move', from: 'g8', to: 'f6' },     // 22... Nxf6
      { type: 'move', from: 'd6', to: 'e7' },     // 23. Be7# CHECKMATE!
    ];

    let moveIndex = 0;
    const playNextMove = () => {
      if (!this._examplePlaying || moveIndex >= demoMoves.length) {
        // The Immortal Game ends in checkmate - demo complete!
        // Just stop playing (no CPU needed, game is over)
        this._stopExamplePlay();
        return;
      }

      const action = demoMoves[moveIndex];
      const tlId = action.timeline ?? this.activeTimelineId;
      const tl = this.timelines[tlId];

      if (tl && action.type === 'move' && action.from && action.to) {
        try {
          const validMoves = tl.chess.moves({ verbose: true }) as ChessMove[];
          const chessMove = validMoves.find(m => m.from === action.from && m.to === action.to);
          if (chessMove) {
            this.makeMove(tlId, chessMove);
          } else {
            console.warn('[Demo] Move not found:', action);
          }
        } catch (e) {
          console.warn('[Demo] Move failed:', action, e);
        }
      }

      moveIndex++;
      this._exampleTimer = window.setTimeout(playNextMove, 400);
    };

    // Start playing
    this._exampleTimer = window.setTimeout(playNextMove, 300);
  }

  private _stopExamplePlay(): void {
    this._examplePlaying = false;
    if (this._exampleTimer !== null) {
      clearTimeout(this._exampleTimer);
      this._exampleTimer = null;
    }
    this.cpuStop();

    const btn = document.getElementById('example-play');
    if (btn) {
      btn.classList.remove('running');
      btn.textContent = '▶ Demo';
    }
  }

  /* -- Keyboard Navigation -- */
  private _setupKeyboardNav(): void {
    document.addEventListener('keydown', (e) => {
      // Don't capture if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this.navigateMove(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.navigateMove(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          Board3D.cycleBoard(-1);  // Previous board
          break;
        case 'ArrowDown':
          e.preventDefault();
          Board3D.cycleBoard(1);   // Next board
          break;
        case 'Tab':
          e.preventDefault();
          this.cycleTimeline(e.shiftKey ? -1 : 1);
          break;
        case ' ':
          e.preventDefault();
          this.flipBoard();
          break;
        case 'Home':
          e.preventDefault();
          this.goToMove(0);
          break;
        case 'End':
          e.preventDefault();
          this.goToMove(-1); // -1 = last move
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          this.focusActiveTimeline();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          this.resetCameraView();
          break;
        // Number keys 1-9 to select specific board
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          e.preventDefault();
          Board3D.selectBoard(parseInt(e.key) - 1);
          break;
        case '0':
          e.preventDefault();
          Board3D.selectBoard(9);  // 0 selects 10th board
          break;
        // Z key to zoom in on selected board
        case 'z':
        case 'Z':
          e.preventDefault();
          Board3D.zoomInOnSelected();
          break;
        // X key to zoom out / show all
        case 'x':
        case 'X':
          e.preventDefault();
          Board3D.zoomOut();
          break;
        // V key to toggle zoom
        case 'v':
        case 'V':
          e.preventDefault();
          Board3D.toggleZoom();
          break;
        // T key to toggle 2D top-down mode
        case 't':
        case 'T':
          e.preventDefault();
          Board3D.toggle2DMode();
          this._update2DButtonUI();
          break;
      }
    });
  }

  /* -- Collapsible Shortcuts Panel -- */
  private _setupCollapsibleShortcuts(): void {
    const panel = document.getElementById('shortcuts-panel');
    const header = document.getElementById('shortcuts-header');
    if (panel && header && !header.hasAttribute('data-collapse-init')) {
      header.setAttribute('data-collapse-init', 'true');
      header.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
      });
    }
  }

  /* -- Move Slider -- */
  private _setupMoveSlider(): void {
    const sliderContainer = document.createElement('div');
    sliderContainer.id = 'move-slider-container';
    sliderContainer.innerHTML =
      '<input type="range" id="move-slider" min="0" max="0" value="0">' +
      '<div id="move-slider-label">Move 0/0</div>';

    // Insert before the moves panel
    const movesEl = document.getElementById('moves');
    if (movesEl?.parentNode) {
      movesEl.parentNode.insertBefore(sliderContainer, movesEl);
    }

    const slider = document.getElementById('move-slider') as HTMLInputElement | null;
    if (slider) {
      slider.addEventListener('input', () => {
        this.goToMove(parseInt(slider.value));
      });
    }
  }

  /* -- CPU Controls -- */
  private _setupCpuControls(): void {
    const cpuToggle = document.getElementById('cpu-toggle');
    if (cpuToggle) {
      cpuToggle.addEventListener('click', () => this.cpuToggle());
    }

    const speedSlider = document.getElementById('cpu-speed') as HTMLInputElement | null;
    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        // Direct mapping: slider value = delay (right side = higher value = slower)
        // Actually want: right = faster = lower delay
        // So invert: delay = 2100 - sliderValue
        const sliderVal = parseInt(speedSlider.value);
        this.cpuSetDelay(2100 - sliderVal);
      });
    }

    const maxTimelinesSlider = document.getElementById('max-timelines') as HTMLInputElement | null;
    const maxTimelinesValue = document.getElementById('max-timelines-value');
    if (maxTimelinesSlider) {
      maxTimelinesSlider.addEventListener('input', () => {
        const val = parseInt(maxTimelinesSlider.value);
        this.setMaxTimelines(val);
        if (maxTimelinesValue) {
          maxTimelinesValue.textContent = val.toString();
        }
      });
    }

    const cameraToggle = document.getElementById('cpu-camera-toggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => {
        this.cpuCameraFollow = !this.cpuCameraFollow;
        this._updateCpuUI();
      });
    }

    // 2D mode toggle button
    const mode2DToggle = document.getElementById('2d-mode-toggle');
    if (mode2DToggle) {
      mode2DToggle.addEventListener('click', () => {
        Board3D.toggle2DMode();
        this._update2DButtonUI();
      });
    }

    // White CPU controls
    const whiteToggle = document.getElementById('cpu-white-toggle');
    if (whiteToggle) {
      whiteToggle.addEventListener('click', () => {
        this.cpuWhiteEnabled = !this.cpuWhiteEnabled;
        this._updateCpuUI();
      });
    }

    // Black CPU toggle
    const blackToggle = document.getElementById('cpu-black-toggle');
    if (blackToggle) {
      blackToggle.addEventListener('click', () => {
        this.cpuBlackEnabled = !this.cpuBlackEnabled;
        this._updateCpuUI();
      });
    }

    // Unified 5D controls (apply to both colors)
    const crossTimelineSlider = document.getElementById('cpu-cross-timeline') as HTMLInputElement | null;
    const crossTimelineValue = document.getElementById('cpu-cross-timeline-value');
    if (crossTimelineSlider) {
      crossTimelineSlider.addEventListener('input', () => {
        const val = parseInt(crossTimelineSlider.value);
        this.cpuCrossTimelineChance = val / 100;
        if (crossTimelineValue) crossTimelineValue.textContent = `${val}%`;
      });
    }

    const timeTravelSlider = document.getElementById('cpu-time-travel') as HTMLInputElement | null;
    const timeTravelValue = document.getElementById('cpu-time-travel-value');
    if (timeTravelSlider) {
      timeTravelSlider.addEventListener('input', () => {
        const val = parseInt(timeTravelSlider.value);
        this.cpuTimeTravelChance = val / 100;
        if (timeTravelValue) timeTravelValue.textContent = `${val}%`;
      });
    }

    // Unified per-piece portal sliders (apply to both colors)
    const pieceTypes = ['q', 'r', 'b', 'n'] as const;
    for (const pt of pieceTypes) {
      const slider = document.getElementById(`cpu-portal-${pt}`) as HTMLInputElement | null;
      if (slider) {
        slider.addEventListener('input', () => {
          const val = parseInt(slider.value) / 100;
          this.cpuWhitePortalBias[pt] = val;
          this.cpuBlackPortalBias[pt] = val;
          // Update the label
          const span = slider.nextElementSibling;
          if (span) span.textContent = slider.value;
        });
      }
    }

    // Speed slider display - show actual delay (inverted from slider value)
    const speedSlider2 = document.getElementById('cpu-speed') as HTMLInputElement | null;
    const speedValue = document.getElementById('cpu-speed-value');
    if (speedSlider2 && speedValue) {
      speedSlider2.addEventListener('input', () => {
        // Show actual delay: slider 100 = 2000ms delay (slow), slider 2000 = 100ms delay (fast)
        const actualDelay = 2100 - parseInt(speedSlider2.value);
        speedValue.textContent = `${actualDelay}ms`;
      });
    }

    // FIX: Blur sliders after interaction to restore WASD keyboard control
    // Range inputs keep focus after dragging, which blocks keyboard events
    document.querySelectorAll('#cpu-controls input[type="range"]').forEach(slider => {
      slider.addEventListener('change', () => {
        (slider as HTMLInputElement).blur();
      });
    });

    // Disable camera follow when user pans manually
    const sceneContainer = document.getElementById('scene-container');
    if (sceneContainer) {
      sceneContainer.addEventListener('pointerdown', () => {
        if (this.cpuEnabled && this.cpuCameraFollow) {
          this.cpuCameraFollow = false;
          this._updateCpuUI();
        }
      });
    }

    // Stockfish controls
    const sfToggle = document.getElementById('cpu-stockfish-toggle');
    if (sfToggle) {
      sfToggle.addEventListener('click', () => this.toggleStockfish());
    }

    // Dumb CPU mode toggle (random moves instead of Stockfish)
    const dumbToggle = document.getElementById('cpu-dumb-toggle');
    if (dumbToggle) {
      dumbToggle.addEventListener('click', () => {
        this.cpuUseStockfish = !this.cpuUseStockfish;
        this._updateCpuUI();
      });
    }

    // Per-color skill sliders
    const sfSkillWhiteSlider = document.getElementById('cpu-stockfish-skill-white') as HTMLInputElement | null;
    const sfSkillWhiteValue = document.getElementById('cpu-stockfish-skill-white-value');
    if (sfSkillWhiteSlider) {
      sfSkillWhiteSlider.addEventListener('input', () => {
        const val = parseInt(sfSkillWhiteSlider.value);
        this.setStockfishSkillWhite(val);
        if (sfSkillWhiteValue) {
          sfSkillWhiteValue.textContent = val.toString();
        }
      });
    }

    const sfSkillBlackSlider = document.getElementById('cpu-stockfish-skill-black') as HTMLInputElement | null;
    const sfSkillBlackValue = document.getElementById('cpu-stockfish-skill-black-value');
    if (sfSkillBlackSlider) {
      sfSkillBlackSlider.addEventListener('input', () => {
        const val = parseInt(sfSkillBlackSlider.value);
        this.setStockfishSkillBlack(val);
        if (sfSkillBlackValue) {
          sfSkillBlackValue.textContent = val.toString();
        }
      });
    }

    const sfDepthSlider = document.getElementById('cpu-stockfish-depth') as HTMLInputElement | null;
    const sfDepthValue = document.getElementById('cpu-stockfish-depth-value');
    if (sfDepthSlider) {
      sfDepthSlider.addEventListener('input', () => {
        const val = parseInt(sfDepthSlider.value);
        this.setStockfishDepth(val);
        if (sfDepthValue) {
          sfDepthValue.textContent = val.toString();
        }
      });
    }
  }

  /* -- Command Input for Programmatic Testing -- */
  private _setupCommandInput(): void {
    const input = document.getElementById('command-input') as HTMLInputElement | null;
    const output = document.getElementById('command-output');
    if (!input || !output) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = input.value.trim().toLowerCase();
        const result = this._executeCommand(cmd);
        output.textContent = result.message;
        output.classList.add('visible');
        output.classList.toggle('error', !result.success);
        if (result.success) {
          input.value = '';
        }
      }
    });
  }

  /* -- Sidebar Resize -- */
  private _setupSidebarResize(): void {
    const sidebar = document.getElementById('sidebar');
    const resizeHandle = document.getElementById('sidebar-resize');
    if (!sidebar || !resizeHandle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing) return;
      const diff = startX - e.clientX; // Negative because sidebar is on right
      // Constrain to sensible limits based on viewport
      const maxWidth = Math.min(500, window.innerWidth * 0.5);
      const minWidth = 180;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + diff));
      sidebar.style.width = newWidth + 'px';
      sidebar.style.minWidth = newWidth + 'px';
      sidebar.style.maxWidth = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
      }
    });
  }

  /* -- Timeline Panel Resize and Collapse -- */
  private _setupTimelinePanel(): void {
    const panel = document.getElementById('timeline-panel');
    const header = document.getElementById('timeline-header');
    const resizeHandle = document.getElementById('timeline-resize');
    const listEl = document.getElementById('timeline-list');
    if (!panel || !header) return;

    // Collapse/expand on header click
    header.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });

    // Event delegation for timeline item clicks - always works even during DOM updates
    if (listEl) {
      listEl.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        // Find the closest .tl-item parent
        const item = target.closest('.tl-item:not(.empty)') as HTMLElement | null;
        if (item && item.dataset.tlId !== undefined) {
          const tlId = parseInt(item.dataset.tlId);
          this.setActiveTimeline(tlId);
        }
      });
    }

    // Resize functionality
    if (!resizeHandle) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = panel.offsetHeight;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing) return;
      const diff = e.clientY - startY;
      // Constrain to sensible limits
      const maxHeight = 500;
      const minHeight = 60;
      const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + diff));
      panel.style.maxHeight = newHeight + 'px';
      // Update timeline-list max-height (panel height minus header height ~32px)
      const listEl = document.getElementById('timeline-list');
      if (listEl) {
        listEl.style.maxHeight = (newHeight - 32) + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
      }
    });
  }

  private _executeCommand(cmd: string): { success: boolean; message: string } {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return { success: false, message: 'No active timeline' };

    // help command
    if (cmd === 'help') {
      return {
        success: true,
        message: `Commands:
e2e4 - make move (from-to)
fen - show current FEN
select e2 - select square
timetravel N - travel to turn N
switch N - switch to timeline N
reset - new game
timelines - list timelines`,
      };
    }

    // fen command
    if (cmd === 'fen') {
      return { success: true, message: tl.chess.fen() };
    }

    // reset command
    if (cmd === 'reset') {
      this.reset();
      return { success: true, message: 'Game reset' };
    }

    // timelines command
    if (cmd === 'timelines') {
      const tlList = Object.keys(this.timelines).map(id => {
        const t = this.timelines[parseInt(id)];
        return `${id}: ${t.name} (${t.moveHistory.length} moves)`;
      }).join('\n');
      return { success: true, message: tlList };
    }

    // switch N command
    const switchMatch = cmd.match(/^switch\s+(\d+)$/);
    if (switchMatch) {
      const tlId = parseInt(switchMatch[1]);
      if (this.timelines[tlId]) {
        this.setActiveTimeline(tlId);
        return { success: true, message: `Switched to timeline ${tlId}` };
      }
      return { success: false, message: `Timeline ${tlId} not found` };
    }

    // select SQ command
    const selectMatch = cmd.match(/^select\s+([a-h][1-8])$/);
    if (selectMatch) {
      const sq = selectMatch[1];
      this._handleBoardClick(this.activeTimelineId, sq);
      return { success: true, message: `Selected ${sq}` };
    }

    // timetravel N command
    const ttMatch = cmd.match(/^timetravel\s+(\d+)$/);
    if (ttMatch) {
      const turnIdx = parseInt(ttMatch[1]);
      if (!this.timeTravelSelection) {
        return { success: false, message: 'Select a queen first with time travel targets' };
      }
      const target = this.timeTravelSelection.validTargets.find(t => t.targetTurnIndex === turnIdx);
      if (!target) {
        return { success: false, message: `No time travel target at turn ${turnIdx}` };
      }
      this._makeTimeTravelMove(
        this.timeTravelSelection.sourceTimelineId,
        this.timeTravelSelection.sourceSquare,
        target.targetTurnIndex,
        this.timeTravelSelection.piece
      );
      return { success: true, message: `Time traveled to turn ${turnIdx}` };
    }

    // move command (e2e4 format)
    const moveMatch = cmd.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (moveMatch) {
      const from = moveMatch[1];
      const to = moveMatch[2];
      const promotion = moveMatch[3] as PieceType | undefined;

      const moves = tl.chess.moves({ verbose: true }) as ChessMove[];
      const move = moves.find(m => m.from === from && m.to === to);
      if (!move) {
        return { success: false, message: `Invalid move: ${from}-${to}` };
      }
      this.makeMove(this.activeTimelineId, move, promotion);
      return { success: true, message: `Moved ${from}-${to}` };
    }

    return { success: false, message: `Unknown command: ${cmd}. Type 'help' for commands.` };
  }

  private _updateMoveSlider(): void {
    const slider = document.getElementById('move-slider') as HTMLInputElement | null;
    const label = document.getElementById('move-slider-label');
    const tl = this.timelines[this.activeTimelineId];
    if (!tl || !slider || !label) return;

    const totalMoves = tl.moveHistory.length;
    const currentMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;

    slider.max = String(totalMoves);
    slider.value = String(currentMove);
    label.textContent = 'Move ' + currentMove + '/' + totalMoves;

    // Visual indicator when not at current position
    if (this.viewingMoveIndex !== null && this.viewingMoveIndex < totalMoves) {
      label.classList.add('viewing-history');
    } else {
      label.classList.remove('viewing-history');
    }
  }

  /* -- Navigation Methods -- */
  navigateMove(delta: number): void {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const totalMoves = tl.moveHistory.length;
    const currentMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;
    const newMove = Math.max(0, Math.min(totalMoves, currentMove + delta));

    this.goToMove(newMove);
  }

  goToMove(moveIndex: number): void {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const totalMoves = tl.moveHistory.length;

    // -1 means go to last move (current position)
    if (moveIndex === -1) moveIndex = totalMoves;

    // Clamp to valid range
    moveIndex = Math.max(0, Math.min(totalMoves, moveIndex));

    // If at current position, clear viewing mode
    if (moveIndex === totalMoves) {
      this.viewingMoveIndex = null;
      this.renderTimeline(this.activeTimelineId);
    } else {
      this.viewingMoveIndex = moveIndex;
      // Render the board at that snapshot
      const snapshot = tl.snapshots[moveIndex];
      const board = this._getSnapshotBoard(snapshot);
      Board3D.getTimeline(this.activeTimelineId)?.render(board);
    }

    this._updateMoveSlider();
    this.updateStatus();
    this._highlightCurrentMoveInList();
  }

  private _highlightCurrentMoveInList(): void {
    const movesEl = document.getElementById('moves');
    if (!movesEl) return;
    const pairs = movesEl.querySelectorAll('.move-pair');
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const totalMoves = tl.moveHistory.length;
    const viewingMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;

    pairs.forEach((pair, idx) => {
      const pairStartMove = idx * 2 + 1; // Move 1 is at pair 0
      const pairEndMove = idx * 2 + 2;

      if (viewingMove >= pairStartMove && viewingMove <= pairEndMove) {
        pair.classList.add('current-move');
      } else if (viewingMove < pairStartMove) {
        pair.classList.add('future-move');
      } else {
        pair.classList.remove('current-move', 'future-move');
      }
    });
  }

  cycleTimeline(direction: number): void {
    const ids = Object.keys(this.timelines).map(Number).sort((a, b) => a - b);
    if (ids.length <= 1) return;

    const currentIdx = ids.indexOf(this.activeTimelineId);
    const newIdx = (currentIdx + direction + ids.length) % ids.length;
    this.setActiveTimeline(ids[newIdx]);
  }

  flipBoard(): void {
    // Toggle camera position to flip perspective
    if (Board3D.controls && Board3D.camera) {
      const camera = Board3D.camera;
      const target = Board3D.controls.target;

      // Rotate camera 180 degrees around the Y axis relative to target
      const dx = camera.position.x - target.x;
      const dz = camera.position.z - target.z;

      camera.position.x = target.x - dx;
      camera.position.z = target.z - dz;

      Board3D.controls.update();
    }
  }

  focusActiveTimeline(): void {
    Board3D.focusTimeline(this.activeTimelineId, true);
  }

  resetCameraView(): void {
    // Reset to default camera position centered on active timeline
    const tl = this.timelines[this.activeTimelineId];
    const targetX = tl ? tl.xOffset : 0;

    if (Board3D.camera && Board3D.controls) {
      Board3D.camera.position.set(targetX, 14, 12);
      Board3D.controls.target.set(targetX, 0, 0);
      Board3D.controls.update();
    }
  }

  /* -- Timeline management -- */
  private _createTimeline(
    id: number,
    xOffset: number,
    parentId: number | null,
    branchTurn: number,
    initialFen: string | null
  ): TimelineData {
    let chess: ChessInstance;
    if (initialFen) {
      chess = new Chess();
      const loaded = chess.load(initialFen);
      if (!loaded) {
        console.error('[_createTimeline] MISSING_BOARD_BUG: Failed to load FEN:', initialFen, {
          timelineId: id,
          parentId,
          branchTurn,
        });
        // Fallback to starting position
        chess = new Chess();
      }
    } else {
      chess = new Chess();
    }

    const tlData: TimelineData = {
      id,
      chess,
      moveHistory: [],
      snapshots: [],
      parentId,
      branchTurn,
      xOffset,
      name: parentId === null ? 'Main' : 'Branch ' + id,
    };

    this.timelines[id] = tlData;

    // Take initial snapshot
    this.timelines[id].snapshots.push(this._cloneBoard(chess));

    Board3D.createTimeline(id, xOffset);

    // If in 2D mode, refresh the grid to include the new timeline
    if (Board3D.is2DMode()) {
      Board3D.set2DMode(false);
      Board3D.set2DMode(true);
    }

    return this.timelines[id];
  }

  getTimeline(id: number): TimelineData | undefined {
    return this.timelines[id];
  }

  setActiveTimeline(id: number, autoFocus: boolean = true): void {
    const previousId = this.activeTimelineId;
    this.activeTimelineId = id;
    this.viewingMoveIndex = null; // Reset to current position when switching timelines
    Board3D.setActiveTimeline(id);
    this.clearSelection();
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();
    this._updateMoveSlider();

    // Auto-focus on the new timeline with animation (if switching timelines and autoFocus enabled)
    if (autoFocus && previousId !== id) {
      Board3D.focusTimeline(id, true);
    }
  }

  /* -- Click handling -- */
  handleClick(info: SquareClickInfo): void {
    const tlId = info.timelineId;

    // While the CPU is mid-move, only allow camera focus (no piece interaction)
    if (this.cpuEnabled && this.cpuMoveInProgress) {
      if (tlId !== this.activeTimelineId) {
        this.setActiveTimeline(tlId);
      } else {
        Board3D.focusTimeline(tlId, true);
      }
      return;
    }

    const sq = info.square;
    const isHistory = info.isHistory;
    const turn = info.turn;

    // Check for time travel portal click (clicking history board with time travel active)
    if (isHistory && this.timeTravelSelection) {
      const target = this.timeTravelSelection.validTargets.find(
        (t) => t.sourceTimelineId === tlId && t.targetTurnIndex === turn && t.targetSquare === sq
      );
      if (target) {
        // Execute time travel move!
        this._makeTimeTravelMove(
          this.timeTravelSelection.sourceTimelineId,
          this.timeTravelSelection.sourceSquare,
          target.targetTurnIndex,
          this.timeTravelSelection.piece
        );
        return;
      }
    }

    // History boards are read-only unless clicking a time travel target
    if (isHistory) return;

    // Check for cross-timeline move first
    if (this.crossTimelineSelection && tlId !== this.crossTimelineSelection.sourceTimelineId) {
      // Check if this is a valid cross-timeline target
      const target = this.crossTimelineSelection.validTargets.find(
        (t) => t.targetTimelineId === tlId && t.targetSquare === sq
      );
      if (target) {
        // Execute cross-timeline move!
        // sourceSquare is where piece is on source board
        // targetSquare (sq) is where user clicked to land on target board
        this.makeCrossTimelineMove(
          this.crossTimelineSelection.sourceTimelineId,
          tlId,
          this.crossTimelineSelection.sourceSquare,
          sq as Square,
          this.crossTimelineSelection.piece
        );
        return;
      }
      // Clicked on a different timeline but not a valid target - clear selection
      this.clearSelection();
    }

    // Clicking on a non-active timeline's current board -> switch to it
    if (tlId !== this.activeTimelineId) {
      this.setActiveTimeline(tlId);
    } else {
      // Clicking the active timeline - still focus camera on it
      // (useful when camera has been moved away during CPU play)
      Board3D.focusTimeline(tlId, true);
    }

    // Normal board interaction on active timeline
    this._handleBoardClick(tlId, sq);
  }

  private _handleBoardClick(tlId: number, sq: string): void {
    const tl = this.timelines[tlId];
    if (!tl) return;
    const chess = tl.chess;
    const piece = chess.get(sq);
    const col = Board3D.getTimeline(tlId);
    if (!col) return;

    if (this.selected && this.selectedTimelineId === tlId) {
      // Try to make a move
      const moves = chess.moves({ square: this.selected, verbose: true }) as ChessMove[];
      let targetMove: ChessMove | null = null;
      for (let i = 0; i < moves.length; i++) {
        if (moves[i].to === sq) {
          targetMove = moves[i];
          break;
        }
      }

      if (targetMove) {
        this.makeMove(tlId, targetMove);
        return;
      }

      if (sq === this.selected) {
        this.clearSelection();
        return;
      }
    }

    if (piece && piece.color === chess.turn() && !this._isCpuControlled(piece.color)) {
      this.clearSelection();
      this.selected = sq;
      this.selectedTimelineId = tlId;
      const legalMoves = chess.moves({ square: sq, verbose: true }) as ChessMove[];
      col.select(sq);
      col.showLegalMoves(legalMoves, chess.board());

      // Check for cross-timeline movement capability
      if (this.canMoveCrossTimeline(piece.type)) {
        const crossTargets = this.getCrossTimelineTargets(tlId, sq as Square, piece);
        if (crossTargets.length > 0) {
          this.crossTimelineSelection = {
            sourceTimelineId: tlId,
            sourceSquare: sq as Square,
            piece,
            validTargets: crossTargets,
          };
          // Show cross-timeline targets in other timelines
          this._showCrossTimelineTargets(crossTargets);
        }

        // Check for time travel capability (queen moving backward in time)
        const timeTravelTargets = this._getTimeTravelTargets(tlId, sq as Square, piece);
        if (timeTravelTargets.length > 0) {
          this.timeTravelSelection = {
            sourceTimelineId: tlId,
            sourceSquare: sq as Square,
            piece,
            validTargets: timeTravelTargets,
          };
          // Show time travel portal targets on history boards
          this._showTimeTravelTargets(timeTravelTargets);
        }
      }
    } else {
      this.clearSelection();
    }
  }

  /* -- Move execution -- */
  makeMove(tlId: number, move: ChessMove, promotionPiece?: PieceType): boolean {
    const tl = this.timelines[tlId];
    if (!tl) return false;

    // Clear history viewing mode when a move is made - ensures render uses current state
    if (this.viewingMoveIndex !== null && tlId === this.activeTimelineId) {
      this.viewingMoveIndex = null;
    }

    const chess = tl.chess;
    const isWhite = chess.turn() === 'w';
    const isPromotion = !!move.flags && move.flags.indexOf('p') !== -1;

    // Pawn promotion needs a piece choice from the user
    if (isPromotion && !promotionPiece) {
      this.pendingPromotion = { tlId, move };
      this._showPromotionPicker(tlId, move.to, isWhite);
      return false;
    }

    const boardBefore = this._cloneBoard(chess);
    const moveObj: { from: string; to: string; promotion?: PieceType } = { from: move.from, to: move.to };
    if (isPromotion) moveObj.promotion = promotionPiece || 'q';

    const result = chess.move(moveObj);
    if (!result) {
      console.error('Invalid move:', moveObj);
      return false;
    }

    // Use result.captured (actual move result) instead of move.captured (potential move)
    tl.moveHistory.push({
      from: move.from as Move['from'],
      to: move.to as Move['to'],
      piece: move.piece,
      captured: result.captured || null,
      san: result.san,
      isWhite,
      promotion: result.promotion || null,
    });
    tl.snapshots.push(this._cloneBoard(chess));
    this._validateSnapshotConsistency(tl);

    const col = Board3D.getTimeline(tlId);
    if (col) {
      col.addSnapshot(this._getSnapshotBoard(boardBefore), move.from, move.to, isWhite);
      col.addMoveLine(move.from, move.to, isWhite);
      col.showLastMove(move.from, move.to);
    }
    Board3D.notifySnapshotAdded(tlId);

    if (result.captured) {
      Board3D.spawnCaptureEffect(tlId, move.to);
    }

    this.clearSelection();
    this.renderTimeline(tlId);
    col?.animatePieceMove(move.from, move.to);
    this._afterMove();
    return true;
  }

  /* -- Cross-Timeline Movement -- */

  /** Check if a piece type can move across timelines (all pieces except King) */
  private canMoveCrossTimeline(pieceType: PieceType): boolean {
    // All pieces except King can cross timelines
    // King cannot leave its board - would break check/checkmate logic
    return pieceType !== 'k';
  }

  /** Check if a timeline is finished (checkmate, stalemate, or draw) */
  private isTimelineFinished(tl: TimelineData): boolean {
    return tl.chess.in_checkmate() || tl.chess.in_stalemate() || tl.chess.in_draw();
  }

  /** Get all valid cross-timeline targets for a piece */
  private getCrossTimelineTargets(
    sourceTimelineId: number,
    square: Square,
    piece: Piece
  ): CrossTimelineMoveTarget[] {
    if (!canCrossTimelines(piece.type)) return [];
    const sourceTl = this.timelines[sourceTimelineId];
    if (!sourceTl) return [];

    const sourceFen = sourceTl.chess.fen();
    const targets: CrossTimelineMoveTarget[] = [];

    for (const targetTl of Object.values(this.timelines)) {
      if (targetTl.id === sourceTimelineId) continue;
      // Cannot move to a finished timeline (checkmate/stalemate/draw)
      if (this.isTimelineFinished(targetTl)) continue;
      // Cross-timeline moves count on both boards, so they must be in sync
      if (targetTl.moveHistory.length !== sourceTl.moveHistory.length) continue;

      const targetFen = targetTl.chess.fen();
      for (const targetSquare of crossTimelineLandingSquares(targetFen, square, piece)) {
        const plan = planCrossTimelineMove(sourceFen, targetFen, square, targetSquare, piece);
        if (!plan.ok) continue;
        targets.push({
          targetTimelineId: targetTl.id,
          targetSquare,
          isCapture: false,
          capturedPiece: null,
        });
      }
    }

    return targets;
  }

  /** Execute a cross-timeline move. Validates fully before changing any state.
   * @param sourceTimelineId - Timeline the piece is leaving
   * @param targetTimelineId - Timeline the piece is arriving in
   * @param sourceSquare - Where the piece is on the source board
   * @param targetSquare - Where the piece lands on the target board
   * @param piece - The piece being moved
   * @returns true if the move was made
   */
  private makeCrossTimelineMove(
    sourceTimelineId: number,
    targetTimelineId: number,
    sourceSquare: Square,
    targetSquare: Square,
    piece: Piece
  ): boolean {
    const sourceTl = this.timelines[sourceTimelineId];
    const targetTl = this.timelines[targetTimelineId];
    if (!sourceTl || !targetTl || sourceTl === targetTl) return false;
    if (this.isTimelineFinished(targetTl)) return false;
    if (sourceTl.moveHistory.length !== targetTl.moveHistory.length) return false;

    const plan = planCrossTimelineMove(sourceTl.chess.fen(), targetTl.chess.fen(), sourceSquare, targetSquare, piece);
    if (!plan.ok) {
      console.warn('[Cross-Timeline] Rejected move:', plan.reason);
      return false;
    }

    const isWhite = piece.color === 'w';
    const sourceBoardBefore = this._cloneBoard(sourceTl.chess);
    const targetBoardBefore = this._cloneBoard(targetTl.chess);
    sourceTl.chess.load(plan.sourceFen);
    targetTl.chess.load(plan.targetFen);

    // Record the move in both timelines
    const pieceChar = piece.type.toUpperCase();
    const promo = plan.placedPiece.type !== piece.type ? '=' + plan.placedPiece.type.toUpperCase() : '';
    const crossMove: Move = {
      from: sourceSquare,
      to: targetSquare,
      piece: piece.type,
      captured: null,
      san: '',
      isWhite,
      promotion: promo ? plan.placedPiece.type : null,
    };
    const departSan = sourceSquare === targetSquare
      ? `${pieceChar}${sourceSquare}→T${targetTimelineId}`
      : `${pieceChar}${sourceSquare}→${targetSquare}@T${targetTimelineId}`;
    const arriveSan = sourceSquare === targetSquare
      ? `${pieceChar}${targetSquare}${promo}←T${sourceTimelineId}`
      : `${pieceChar}${sourceSquare}→${targetSquare}${promo}←T${sourceTimelineId}`;
    sourceTl.moveHistory.push({ ...crossMove, san: departSan });
    sourceTl.snapshots.push(this._cloneBoard(sourceTl.chess));
    targetTl.moveHistory.push({ ...crossMove, san: arriveSan });
    targetTl.snapshots.push(this._cloneBoard(targetTl.chess));

    // Update 3D visualization
    const sourceCol = Board3D.getTimeline(sourceTimelineId);
    const targetCol = Board3D.getTimeline(targetTimelineId);
    if (sourceCol) {
      sourceCol.addSnapshot(this._getSnapshotBoard(sourceBoardBefore), sourceSquare, sourceSquare, isWhite);
      sourceCol.showLastMove(sourceSquare, sourceSquare);
    }
    if (targetCol) {
      targetCol.addSnapshot(this._getSnapshotBoard(targetBoardBefore), targetSquare, targetSquare, isWhite);
      targetCol.showLastMove(targetSquare, targetSquare);
    }
    Board3D.addCrossTimelineLine(sourceTimelineId, targetTimelineId, targetSquare, isWhite);
    Board3D.notifySnapshotAdded(sourceTimelineId);
    Board3D.notifySnapshotAdded(targetTimelineId);

    this.clearSelection();
    this.renderTimeline(sourceTimelineId);
    this.renderTimeline(targetTimelineId);
    this._afterMove();
    return true;
  }

  /* -- Time Travel Movement (backward in time) -- */

  /** Get all valid time travel targets for a piece (moving backward in time) */
  private _getTimeTravelTargets(
    sourceTimelineId: number,
    square: Square,
    piece: Piece
  ): TimeTravelTarget[] {
    if (!canTimeTravel(piece.type)) return [];
    const tl = this.timelines[sourceTimelineId];
    if (!tl || tl.snapshots.length < 2) return [];

    const sourceFen = tl.chess.fen();
    const targets: TimeTravelTarget[] = [];
    // Iterate past snapshots from most recent to oldest (excluding the current board)
    for (let snapshotIdx = tl.snapshots.length - 2; snapshotIdx >= 0; snapshotIdx--) {
      const snapshotFen = this._getSnapshotFen(tl.snapshots[snapshotIdx]);
      if (!snapshotFen) continue;
      const plan = planTimeTravel(sourceFen, snapshotFen, square, piece);
      if (!plan.ok) continue;
      targets.push({
        sourceTimelineId,
        // History layer 0 = snapshot at (length - 2), layer 1 = snapshot at (length - 3), etc.
        targetTurnIndex: tl.snapshots.length - 2 - snapshotIdx,
        targetSquare: square,
        isCapture: plan.captured !== null,
        capturedPiece: plan.captured,
      });
    }
    return targets;
  }

  /** Pick an unused x position for a new child timeline, alternating sides of the parent */
  private _nextChildXOffset(parentId: number): number {
    const parent = this.timelines[parentId];
    const spacing = Board3D.TIMELINE_SPACING;
    const used = new Set(Object.values(this.timelines).map((tl) => tl.xOffset));
    const siblingCount = Object.values(this.timelines).filter((tl) => tl.parentId === parentId).length;
    const side = siblingCount % 2 === 0 ? 1 : -1;
    let xOffset = parent.xOffset + side * spacing * Math.ceil((siblingCount + 1) / 2);
    for (let attempt = 1; used.has(xOffset) && attempt < 200; attempt++) {
      xOffset = parent.xOffset + (attempt % 2 === 0 ? 1 : -1) * Math.ceil(attempt / 2) * spacing;
    }
    return xOffset;
  }

  /** Execute a time travel move - piece goes back in time, creating a new timeline.
   * Validates fully before changing any state. Returns true if the move was made. */
  private _makeTimeTravelMove(
    sourceTimelineId: number,
    sourceSquare: Square,
    targetTurnIndex: number,
    piece: Piece
  ): boolean {
    const sourceTl = this.timelines[sourceTimelineId];
    if (!sourceTl) return false;

    const snapshotIdx = sourceTl.snapshots.length - 2 - targetTurnIndex;
    const targetSnapshot = sourceTl.snapshots[snapshotIdx];
    const snapshotFen = targetSnapshot ? this._getSnapshotFen(targetSnapshot) : null;
    if (!snapshotFen) return false;

    const plan = planTimeTravel(sourceTl.chess.fen(), snapshotFen, sourceSquare, piece);
    if (!plan.ok) {
      console.warn('[Time Travel] Rejected move:', plan.reason);
      return false;
    }

    const isWhite = piece.color === 'w';
    const pieceChar = piece.type.toUpperCase();

    // 1. Piece departs the source timeline
    const sourceBoardBefore = this._cloneBoard(sourceTl.chess);
    sourceTl.chess.load(plan.sourceFen);
    sourceTl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: piece.type,
      captured: null,
      san: `${pieceChar}${sourceSquare}⟳T${targetTurnIndex}`,
      isWhite,
    });
    sourceTl.snapshots.push(this._cloneBoard(sourceTl.chess));

    const sourceCol = Board3D.getTimeline(sourceTimelineId);
    if (sourceCol) {
      sourceCol.addSnapshot(this._getSnapshotBoard(sourceBoardBefore), sourceSquare, sourceSquare, isWhite);
      sourceCol.showLastMove(sourceSquare, sourceSquare);
    }
    Board3D.notifySnapshotAdded(sourceTimelineId);
    Board3D.spawnPortalEffect(sourceTimelineId, sourceSquare);

    // 2. A new timeline branches from the historical point with the piece arriving
    const newId = this.nextTimelineId++;
    const xOffset = this._nextChildXOffset(sourceTimelineId);
    const newTl = this._createTimeline(newId, xOffset, sourceTimelineId, snapshotIdx, plan.arrivalFen);

    newTl.snapshots = [];
    for (let s = 0; s <= snapshotIdx; s++) {
      newTl.snapshots.push(this._deepCloneSnapshot(sourceTl.snapshots[s]));
    }
    newTl.snapshots.push(this._cloneBoard(newTl.chess));

    newTl.moveHistory = sourceTl.moveHistory.slice(0, snapshotIdx).map((m) => ({ ...m }));
    newTl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: piece.type,
      captured: plan.captured?.type || null,
      san: `${pieceChar}${sourceSquare}⟳←T${sourceTimelineId}`,
      isWhite,
    });
    this._validateSnapshotConsistency(newTl);

    const newCol = Board3D.getTimeline(newId);
    if (newCol) {
      for (let h = newTl.moveHistory.length - 1; h >= 0; h--) {
        const mv = newTl.moveHistory[h];
        newCol.addSnapshot(this._getSnapshotBoard(newTl.snapshots[h]), mv.from, mv.to, mv.isWhite);
      }
    }

    // 3. Connection line (vertical drop then horizontal)
    Board3D.addTimeTravelLine(sourceTimelineId, targetTurnIndex, newId, sourceSquare, isWhite);

    // 4. Switch to the new timeline (respect camera follow setting for CPU mode)
    this.clearSelection();
    const shouldFocus = !this.cpuEnabled || this.cpuCameraFollow;
    this.setActiveTimeline(newId, shouldFocus);
    this.renderTimeline(sourceTimelineId);
    this.renderTimeline(newId);
    this._afterMove();

    Board3D.spawnPortalEffect(newId, sourceSquare);
    if (plan.captured) {
      Board3D.spawnCaptureEffect(newId, sourceSquare);
    }
    return true;
  }

  /** Shared UI refresh after any committed move */
  private _afterMove(): void {
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();
    this._updateMoveSlider();
    // The CPU loop reports game end itself; human games need it here
    if (!this.cpuEnabled && this.isGlobalGameOver()) {
      this._handleGameEnd();
    }
  }

  /* -- Promotion UI -- */
  private _showPromotionPicker(tlId: number, square: string, isWhite: boolean): void {
    const existing = document.getElementById('promotion-picker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'promotion-picker';
    picker.innerHTML =
      '<div class="promo-title">Promote to:</div>' +
      '<div class="promo-options">' +
      '<button data-piece="q" title="Queen">' + (isWhite ? '\u2655' : '\u265B') + '</button>' +
      '<button data-piece="r" title="Rook">' + (isWhite ? '\u2656' : '\u265C') + '</button>' +
      '<button data-piece="b" title="Bishop">' + (isWhite ? '\u2657' : '\u265D') + '</button>' +
      '<button data-piece="n" title="Knight">' + (isWhite ? '\u2658' : '\u265E') + '</button>' +
      '</div>';

    picker.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const piece = btn.getAttribute('data-piece') as PieceType | null;
        picker.remove();
        if (this.pendingPromotion && piece) {
          const pending = this.pendingPromotion;
          this.pendingPromotion = null;
          this.makeMove(pending.tlId, pending.move, piece);
        }
      });
    });

    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Choose promotion piece');
    document.body.appendChild(picker);
    (picker.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  /* -- Snapshot consistency validation -- */
  private _validateSnapshotConsistency(tl: TimelineData): void {
    // Invariant: snapshots.length === moveHistory.length + 1
    // (snapshot[0] is initial state, each move adds one snapshot)
    if (tl.snapshots.length !== tl.moveHistory.length + 1) {
      console.error('SNAPSHOT CONSISTENCY ERROR:', {
        timeline: tl.id,
        snapshotsLength: tl.snapshots.length,
        moveHistoryLength: tl.moveHistory.length,
        expected: 'snapshots.length === moveHistory.length + 1',
      });
      throw new Error('GameStateError: Snapshot/moveHistory mismatch on timeline ' + tl.id);
    }
  }

  /* -- Rendering -- */
  renderTimeline(tlId: number): void {
    const tl = this.timelines[tlId];
    if (!tl) {
      console.error('[renderTimeline] MISSING_BOARD_BUG: Timeline data not found for id:', tlId);
      return;
    }
    const col = Board3D.getTimeline(tlId);
    if (!col) {
      console.error('[renderTimeline] MISSING_BOARD_BUG: 3D timeline not found for id:', tlId);
      return;
    }

    const board = tl.chess.board();
    // Count pieces on the board
    let pieceCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r] && board[r][c]) pieceCount++;
      }
    }
    if (pieceCount === 0) {
      console.error('[renderTimeline] MISSING_BOARD_BUG: Board has 0 pieces!', {
        timelineId: tlId,
        fen: tl.chess.fen(),
        board,
      });
    }

    col.render(board);

    // Update board glow based on game state
    if (tl.chess.in_checkmate()) {
      col.setBoardGlow('checkmate');
    } else if (tl.chess.in_draw() || tl.chess.in_stalemate()) {
      col.setBoardGlow('draw');
    } else {
      col.setBoardGlow('none');
    }
  }

  clearSelection(): void {
    if (this.selectedTimelineId !== null) {
      const col = Board3D.getTimeline(this.selectedTimelineId);
      if (col) col.clearHighlights();
    }
    // Clear cross-timeline highlights
    if (this.crossTimelineSelection) {
      this._clearCrossTimelineTargets();
      this.crossTimelineSelection = null;
    }
    // Clear time travel highlights
    if (this.timeTravelSelection) {
      this._clearTimeTravelTargets();
      this.timeTravelSelection = null;
    }
    this.selected = null;
    this.selectedTimelineId = null;
    // Dismiss a promotion picker that no longer matches the board
    if (this.pendingPromotion) {
      this.pendingPromotion = null;
      document.getElementById('promotion-picker')?.remove();
    }
  }

  /** Show cross-timeline target indicators in other timelines */
  private _showCrossTimelineTargets(targets: CrossTimelineMoveTarget[]): void {
    // Group targets by timeline to show board glow border once per board
    const targetsByTimeline = new Map<number, CrossTimelineMoveTarget[]>();
    for (const target of targets) {
      const existing = targetsByTimeline.get(target.targetTimelineId) || [];
      existing.push(target);
      targetsByTimeline.set(target.targetTimelineId, existing);
    }

    // Show indicators and board glow for each target timeline
    for (const [tlId, tlTargets] of targetsByTimeline) {
      const col = Board3D.getTimeline(tlId);
      if (col) {
        // Show glowing border around the entire board
        col.showBoardGlowBorder(0xaa44ff);  // Purple for cross-timeline
        // Show individual square targets
        for (const target of tlTargets) {
          col.showCrossTimelineTarget(target.targetSquare, target.isCapture);
        }
      }
    }
  }

  /** Clear cross-timeline target indicators */
  private _clearCrossTimelineTargets(): void {
    if (!this.crossTimelineSelection) return;
    for (const target of this.crossTimelineSelection.validTargets) {
      const col = Board3D.getTimeline(target.targetTimelineId);
      if (col) {
        col.clearCrossTimelineTargets();
      }
    }
  }

  /** Show time travel target indicators on history boards */
  private _showTimeTravelTargets(targets: TimeTravelTarget[]): void {
    for (const target of targets) {
      const col = Board3D.getTimeline(target.sourceTimelineId);
      if (col) {
        col.showTimeTravelTarget(target.targetTurnIndex, target.targetSquare, target.isCapture);
      }
    }
  }

  /** Clear time travel target indicators */
  private _clearTimeTravelTargets(): void {
    if (!this.timeTravelSelection) return;
    for (const target of this.timeTravelSelection.validTargets) {
      const col = Board3D.getTimeline(target.sourceTimelineId);
      if (col) {
        col.clearTimeTravelTargets();
      }
    }
  }

  /* -- Board cloning -- */
  // Snapshot format: { fen: string, board: 8x8 array }
  // - fen: full game state for reconstruction (includes castling, en passant, etc.)
  // - board: piece positions for rendering
  private _cloneBoard(chess: ChessInstance): Snapshot {
    const board = chess.board();
    const boardClone: Board = [];
    for (let r = 0; r < 8; r++) {
      boardClone[r] = [];
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        boardClone[r][c] = p ? { type: p.type, color: p.color } : null;
      }
    }
    return {
      fen: chess.fen(),
      board: boardClone,
    };
  }

  private _deepCloneSnapshot(snapshot: AnySnapshot): AnySnapshot {
    // Handle both old format (array) and new format (object with fen/board)
    if (Array.isArray(snapshot)) {
      // Old format: just board array
      const clone: Board = [];
      for (let r = 0; r < 8; r++) {
        clone[r] = [];
        for (let c = 0; c < 8; c++) {
          const p = snapshot[r][c];
          clone[r][c] = p ? { type: p.type, color: p.color } : null;
        }
      }
      return clone;
    }
    // New format: { fen, board }
    const boardClone: Board = [];
    for (let r = 0; r < 8; r++) {
      boardClone[r] = [];
      for (let c = 0; c < 8; c++) {
        const p = snapshot.board[r][c];
        boardClone[r][c] = p ? { type: p.type, color: p.color } : null;
      }
    }
    return {
      fen: snapshot.fen,
      board: boardClone,
    };
  }

  // Helper to get board array from snapshot (handles both formats)
  private _getSnapshotBoard(snapshot: AnySnapshot): Board {
    if (Array.isArray(snapshot)) return snapshot;
    return snapshot.board;
  }

  // Helper to get FEN from snapshot (returns null for old format)
  private _getSnapshotFen(snapshot: AnySnapshot): string | null {
    if (Array.isArray(snapshot)) return null;
    return snapshot.fen;
  }



  /* -- UI updates -- */
  updateStatus(): void {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;
    const chess = tl.chess;
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const prefix =
      Object.keys(this.timelines).length > 1 ? '[' + tl.name + '] ' : '';

    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      statusEl.textContent = prefix + 'Checkmate! ' + winner + ' wins';
      statusEl.style.color = '#ff6b6b';
    } else if (chess.in_draw()) {
      statusEl.textContent = prefix + 'Draw!';
      statusEl.style.color = '#ffd93d';
    } else if (chess.in_check()) {
      statusEl.textContent = prefix + turn + ' \u2014 Check!';
      statusEl.style.color = '#ff6b6b';
    } else {
      statusEl.textContent = prefix + turn + ' to move';
      statusEl.style.color = '#e0e0e0';
    }

    // Update FEN display
    this._updateFenDisplay();
  }

  private _updateFenDisplay(): void {
    const fenText = document.getElementById('fen-text');
    const fenTooltip = document.getElementById('fen-tooltip');
    const fenDisplay = document.getElementById('fen-display');
    if (!fenText || !fenTooltip || !fenDisplay) return;

    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const fen = tl.chess.fen();
    fenText.textContent = fen;
    fenTooltip.textContent = fen;

    // Click to copy
    fenDisplay.onclick = () => {
      navigator.clipboard.writeText(fen).then(() => {
        const original = fenTooltip.textContent;
        fenTooltip.textContent = 'Copied!';
        fenTooltip.style.color = '#6bc96b';
        setTimeout(() => {
          fenTooltip.textContent = original;
          fenTooltip.style.color = '';
        }, 1000);
      });
    };
  }

  updateMoveList(): void {
    const movesEl = document.getElementById('moves');
    if (!movesEl) return;
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) {
      if (this._lastMoveListHtml !== '') {
        movesEl.innerHTML = '';
        this._lastMoveListHtml = '';
      }
      return;
    }
    // Use moveHistory instead of chess.history() because chess.load() wipes history
    // when we modify FEN for time travel/cross-timeline moves
    const history = tl.moveHistory.map(m => m.san);
    let html = '';
    for (let i = 0; i < history.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      const white = history[i];
      const black = history[i + 1] || '';
      html +=
        '<div class="move-pair">' +
        '<span class="move-number">' + num + '.</span>' +
        this._formatMoveWithTooltip(white) +
        this._formatMoveWithTooltip(black) + '</div>';
    }
    // Only update DOM if content changed (avoids unnecessary re-renders)
    if (html !== this._lastMoveListHtml) {
      movesEl.innerHTML = html;
      movesEl.scrollTop = movesEl.scrollHeight;
      this._lastMoveListHtml = html;
    }
  }

  /** Format a move SAN with tooltips for cross-timeline/time-travel notation */
  private _formatMoveWithTooltip(san: string): string {
    if (!san) return '<span class="move"></span>';

    // Cross-timeline moves: Qd4→T2 (piece moves TO timeline) or Qd4←T1 (piece arrives FROM timeline)
    // Time travel moves: Qd4⟳T3 (departure) or Qd4⟳←T1 (arrival via time travel)
    let tooltip = '';
    let cssClass = 'move';

    if (san.includes('⟳←T')) {
      // Time travel arrival: piece arrived via time travel from another timeline
      const match = san.match(/⟳←T(\d+)/);
      if (match) {
        tooltip = `Piece arrives via time travel from Timeline ${match[1]}`;
        cssClass += ' time-travel';
      }
    } else if (san.includes('⟳T')) {
      // Time travel departure: piece time travels to a past turn
      const match = san.match(/⟳T(\d+)/);
      if (match) {
        tooltip = `Piece time travels to turn ${match[1]} (creates new timeline)`;
        cssClass += ' time-travel';
      }
    } else if (san.includes('→T')) {
      // Cross-timeline departure: piece moves TO another timeline
      const match = san.match(/→T(\d+)/);
      if (match) {
        tooltip = `Piece moves TO Timeline ${match[1]}`;
        cssClass += ' cross-timeline';
      }
    } else if (san.includes('←T')) {
      // Cross-timeline arrival: piece arrives FROM another timeline
      const match = san.match(/←T(\d+)/);
      if (match) {
        tooltip = `Piece arrives FROM Timeline ${match[1]}`;
        cssClass += ' cross-timeline';
      }
    }

    if (tooltip) {
      return `<span class="${cssClass}" title="${tooltip}">${san}</span>`;
    }
    return `<span class="${cssClass}">${san}</span>`;
  }

  updateTimelineList(): void {
    const listEl = document.getElementById('timeline-list');
    if (!listEl) return;
    const colors = Board3D.TIMELINE_COLORS;
    const timelines = Object.values(this.timelines).sort((a, b) => a.id - b.id);

    // Rebuild only when the set of timelines changes; otherwise update in place (no scroll jump)
    const structureKey = timelines.map((tl) => tl.id).join(',');
    if (structureKey !== this._lastTimelineStructure) {
      listEl.innerHTML = timelines
        .map((tl) => {
          const hex = '#' + colors[tl.id % colors.length].toString(16).padStart(6, '0');
          return (
            `<div class="tl-item" data-tl-id="${tl.id}" style="--tl-color:${hex}">` +
            '<span class="tl-dot"></span>' +
            `<span class="tl-label">${tl.name}</span>` +
            '<span class="tl-state"></span>' +
            '<span class="tl-turn"></span></div>'
          );
        })
        .join('');
      this._lastTimelineStructure = structureKey;
    }

    listEl.querySelectorAll<HTMLElement>('.tl-item').forEach((el) => {
      const tl = this.timelines[Number(el.dataset.tlId)];
      if (!tl) return;
      el.classList.toggle('active', tl.id === this.activeTimelineId);
      const chess = tl.chess;
      const stateEl = el.querySelector('.tl-state') as HTMLElement;
      let state = chess.turn() === 'w' ? 'to-move-w' : 'to-move-b';
      let title = (chess.turn() === 'w' ? 'White' : 'Black') + ' to move';
      if (chess.in_checkmate()) {
        state = 'mate';
        title = 'Checkmate — ' + (chess.turn() === 'w' ? 'Black' : 'White') + ' wins';
      } else if (chess.in_draw() || chess.in_stalemate()) {
        state = 'draw';
        title = chess.in_stalemate() ? 'Stalemate' : 'Draw';
      } else if (chess.in_check()) {
        state += ' check';
        title += ' (check)';
      }
      stateEl.className = 'tl-state ' + state;
      el.title = `${tl.name}: ${title}`;
      (el.querySelector('.tl-turn') as HTMLElement).textContent = String(tl.moveHistory.length);
    });
  }


  /* -- Get branch points for a timeline -- */
  getBranchPoints(tlId: number): { childId: number; moveIndex: number; name: string }[] {
    const branches: { childId: number; moveIndex: number; name: string }[] = [];
    for (const key in this.timelines) {
      const tl = this.timelines[key];
      if (tl.parentId === tlId) {
        branches.push({
          childId: tl.id,
          moveIndex: tl.branchTurn,
          name: tl.name,
        });
      }
    }
    return branches;
  }

  /* -- Global Game Over Detection -- */

  /**
   * Check if the game is globally over (all timelines in checkmate or stalemate)
   */
  isGlobalGameOver(): boolean {
    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      if (!tl.chess.in_checkmate() && !tl.chess.in_stalemate() && !tl.chess.in_draw()) {
        return false;
      }
    }
    // All timelines are finished
    return Object.keys(this.timelines).length > 0;
  }

  /**
   * Get the global winner (if game is over)
   * Returns 'white', 'black', 'draw', or null if game is not over
   */
  getGlobalWinner(): 'white' | 'black' | 'draw' | null {
    if (!this.isGlobalGameOver()) return null;

    let whiteWins = 0;
    let blackWins = 0;
    let draws = 0;

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      if (tl.chess.in_checkmate()) {
        // The side to move is in checkmate, so the other side wins
        if (tl.chess.turn() === 'w') blackWins++;
        else whiteWins++;
      } else {
        // Stalemate or draw
        draws++;
      }
    }

    // If there are any decisive results, the side with more wins wins
    if (whiteWins > blackWins) return 'white';
    if (blackWins > whiteWins) return 'black';
    return 'draw';
  }

  /**
   * Handle game end - zoom out to show all boards and display stats toast.
   */
  private _handleGameEnd(): void {
    // Zoom out camera to show all boards
    Board3D.zoomOutShowAll();

    // Gather game stats
    const stats = this._getGameEndStats();

    // Display toast notification
    this._showGameEndToast(stats);
  }

  /**
   * Get game end statistics.
   */
  private _getGameEndStats(): {
    winner: 'white' | 'black' | 'draw';
    totalTimelines: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    totalMoves: number;
  } {
    let whiteWins = 0;
    let blackWins = 0;
    let draws = 0;
    let totalMoves = 0;

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      // Branches copy their parent's history up to the branch point; count only their own moves
      totalMoves += tl.moveHistory.length - (tl.parentId === null ? 0 : Math.max(0, tl.branchTurn));

      if (tl.chess.in_checkmate()) {
        if (tl.chess.turn() === 'w') blackWins++;
        else whiteWins++;
      } else {
        draws++;
      }
    }

    const winner = this.getGlobalWinner() || 'draw';

    return {
      winner,
      totalTimelines: Object.keys(this.timelines).length,
      whiteWins,
      blackWins,
      draws,
      totalMoves,
    };
  }

  /**
   * Show game end toast notification.
   */
  private _showGameEndToast(stats: ReturnType<typeof this._getGameEndStats>): void {
    // Remove any existing toast
    const existingToast = document.getElementById('game-end-toast');
    if (existingToast) existingToast.remove();

    // Create toast element
    const toast = document.createElement('div');
    toast.id = 'game-end-toast';
    toast.className = 'game-end-toast';

    // Determine winner text and emoji
    let winnerText: string;
    let winnerEmoji: string;
    if (stats.winner === 'white') {
      winnerText = 'White Wins!';
      winnerEmoji = '♔';
    } else if (stats.winner === 'black') {
      winnerText = 'Black Wins!';
      winnerEmoji = '♚';
    } else {
      winnerText = 'Draw!';
      winnerEmoji = '½';
    }

    toast.innerHTML = `
      <div class="toast-header">
        <span class="toast-title">${winnerEmoji} ${winnerText}</span>
        <button class="toast-close" aria-label="Close">×</button>
      </div>
      <div class="toast-body">
        <div class="toast-stat"><span>Timelines:</span> <strong>${stats.totalTimelines}</strong></div>
        <div class="toast-stat"><span>White wins:</span> <strong>${stats.whiteWins}</strong></div>
        <div class="toast-stat"><span>Black wins:</span> <strong>${stats.blackWins}</strong></div>
        <div class="toast-stat"><span>Draws:</span> <strong>${stats.draws}</strong></div>
        <div class="toast-stat"><span>Total moves:</span> <strong>${stats.totalMoves}</strong></div>
      </div>
    `;

    toast.querySelector('.toast-close')?.addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);

    // Auto-fade after 10 seconds (but stays if user hovers)
    setTimeout(() => {
      if (toast.matches(':hover')) {
        toast.addEventListener('mouseleave', () => toast.classList.add('fading'), { once: true });
      } else {
        toast.classList.add('fading');
      }
    }, 10000);

    toast.addEventListener('animationend', (e) => {
      if (e.animationName === 'fadeOut') toast.remove();
    });
  }

  /* -- FEN Logging System (Phase 2) -- */

  /**
   * Get comprehensive debug info for all boards
   * Returns an object with FEN, turn, move history, etc. for each timeline
   */
  getGameDebugState(): GameDebugState {
    const boards: BoardDebugInfo[] = [];

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      boards.push(getTimelineDebugInfo(
        tl,
        tl.chess.in_checkmate(),
        tl.chess.in_draw(),
        tl.chess.in_check()
      ));
    }

    return {
      timestamp: new Date().toISOString(),
      boards,
      activeTimelineId: this.activeTimelineId,
      totalTimelines: Object.keys(this.timelines).length,
      globalGameOver: this.isGlobalGameOver(),
    };
  }

  /**
   * Log the current game state to console (useful for debugging)
   */
  logGameState(): void {
    logGameState(this.getGameDebugState());
  }

  /**
   * Get FEN for a specific timeline (for user debugging)
   */
  getTimelineFen(tlId: number): string | null {
    const tl = this.timelines[tlId];
    return tl ? tl.chess.fen() : null;
  }

  /**
   * Copy FEN for active timeline to clipboard
   */
  async copyFenToClipboard(): Promise<boolean> {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return false;

    try {
      await navigator.clipboard.writeText(tl.chess.fen());
      return true;
    } catch {
      return false;
    }
  }

  /* -- Reset -- */
  reset(): void {
    // Stop CPU if running
    this.cpuStop();
    this.cpuGlobalTurn = 'w';
    this.clearSelection();

    Board3D.clearAll();
    this.timelines = {};
    this.nextTimelineId = 1;
    this.viewingMoveIndex = null;
    this._lastMoveListHtml = '';
    this._lastTimelineStructure = '';
    const movesEl = document.getElementById('moves');
    if (movesEl) {
      movesEl.innerHTML = '';
    }
    document.getElementById('game-end-toast')?.remove();

    this._createTimeline(0, 0, null, -1, null);
    this.setActiveTimeline(0);
    this.renderTimeline(0);
    this._afterMove();
  }

  /* -- CPU Mode -- */

  // CPU state
  private cpuEnabled = false;
  private cpuTimer: number | null = null;
  private cpuMoveDelay = 400;  // ms between moves (faster for visual effect)
  private maxTimelines = 6;   // Default to 6 total timelines (main + 5 branches), adjustable via slider (0-30)
  private cpuCameraFollow = true;  // Auto-follow moves with camera
  private cpuGlobalTurn: PieceColor = 'w';  // Track whose turn globally (independent of per-timeline state)

  // Lock held while a CPU move (including the engine search) is in progress
  private cpuMoveInProgress = false;
  // Incremented on start/stop/reset so stale async ticks can detect they are obsolete
  private cpuGeneration = 0;
  // Boards still to be played by the side to move in the current global turn (null = not started)
  private cpuTurnQueue: number[] | null = null;

  // Per-color CPU settings
  private cpuWhiteEnabled = true;
  private cpuBlackEnabled = true;
  private cpuWhiteCapturePreference = 0.7;
  private cpuBlackCapturePreference = 0.7;

  // Per-piece portal biases (per color) - higher = more aggressive with 5D moves
  private cpuWhitePortalBias: Record<string, number> = { q: 0.5, r: 0.4, b: 0.35, n: 0.3 };
  private cpuBlackPortalBias: Record<string, number> = { q: 0.5, r: 0.4, b: 0.35, n: 0.3 };

  // 5D Chess aggression settings (increased for more dynamic multi-board play)
  private cpuCrossTimelineChance = 0.75;  // Base chance for cross-timeline moves (0-1)
  private cpuTimeTravelChance = 0.5;      // Base chance for time travel moves (0-1)


  // Stockfish settings
  private cpuUseStockfish = true;  // Use Stockfish when available
  private cpuStockfishSkillWhite = 10;  // Skill level 0-20 for White
  private cpuStockfishSkillBlack = 10;  // Skill level 0-20 for Black
  private cpuStockfishDepth = 10;  // Search depth 1-20

  /** True when the CPU is running and plays this color, so humans may not move it */
  private _isCpuControlled(color: PieceColor): boolean {
    return this.cpuEnabled && (color === 'w' ? this.cpuWhiteEnabled : this.cpuBlackEnabled);
  }

  /** Start CPU auto-play mode */
  cpuStart(): void {
    if (this.cpuEnabled) return;

    // Check if game is already over (all timelines in checkmate/stalemate)
    if (this._cpuIsGameOver()) {
      return;
    }

    this.cpuEnabled = true;
    this.cpuGeneration++;
    this.cpuTurnQueue = null;
    this.cpuMoveInProgress = false;
    this._cpuTick();
    this._updateCpuUI();
  }

  /** Stop CPU auto-play mode */
  cpuStop(): void {
    this.cpuEnabled = false;
    this.cpuGeneration++;  // Invalidate any tick still awaiting the engine
    this.cpuMoveInProgress = false;
    stockfish.stop();
    if (this.cpuTimer !== null) {
      clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    this._updateCpuUI();
  }

  /** Toggle CPU mode */
  cpuToggle(): void {
    if (this.cpuEnabled) {
      this.cpuStop();
    } else {
      this.cpuStart();
    }
  }

  /** Set move delay (100-2000ms) */
  cpuSetDelay(ms: number): void {
    this.cpuMoveDelay = Math.max(100, Math.min(2000, ms));
  }

  /** Set max timelines/branches (0-30, where 0=main only, 6=default with 5 branches) */
  setMaxTimelines(count: number): void {
    // 0 means only main timeline, 1 means main + 1 branch, etc.
    // Clamp to 0-30 range
    this.maxTimelines = Math.max(0, Math.min(30, count));
  }

  /** Toggle camera follow mode */
  cpuSetCameraFollow(follow: boolean): void {
    this.cpuCameraFollow = follow;
    this._updateCpuUI();
  }

  /** Set white CPU enabled */
  cpuSetWhiteEnabled(enabled: boolean): void {
    this.cpuWhiteEnabled = enabled;
    this._updateCpuUI();
  }

  /** Set black CPU enabled */
  cpuSetBlackEnabled(enabled: boolean): void {
    this.cpuBlackEnabled = enabled;
    this._updateCpuUI();
  }

  /** Set white capture preference (0-1) */
  cpuSetWhiteCapturePreference(pref: number): void {
    this.cpuWhiteCapturePreference = Math.max(0, Math.min(1, pref));
  }

  /** Set black capture preference (0-1) */
  cpuSetBlackCapturePreference(pref: number): void {
    this.cpuBlackCapturePreference = Math.max(0, Math.min(1, pref));
  }

  /** Main CPU tick - called repeatedly while enabled */
  private async _cpuTick(): Promise<void> {
    if (!this.cpuEnabled || this.cpuMoveInProgress) return;
    const generation = this.cpuGeneration;
    this.cpuTimer = null;

    // Stop when every timeline is finished (checkmate, stalemate or draw)
    if (this._cpuIsGameOver()) {
      this.cpuStop();
      this._handleGameEnd();
      return;
    }

    const isWhiteTurn = this.cpuGlobalTurn === 'w';
    const cpuActiveForColor = isWhiteTurn ? this.cpuWhiteEnabled : this.cpuBlackEnabled;
    const playable = new Set(cpuActiveForColor ? this._cpuGetPlayableTimelines() : []);

    // Each global turn, the side to move plays once on every board where it is their move.
    // Boards that stopped being playable (e.g. a cross-timeline arrival flipped them) drop out.
    if (this.cpuTurnQueue === null) {
      this.cpuTurnQueue = [...playable];
    }
    this.cpuTurnQueue = this.cpuTurnQueue.filter((id) => playable.has(id));

    if (this.cpuTurnQueue.length > 0) {
      this.cpuMoveInProgress = true;
      try {
        const tlId = this._cpuSelectBestTimeline(this.cpuTurnQueue);
        this.cpuTurnQueue = this.cpuTurnQueue.filter((id) => id !== tlId);
        const moved = await this._cpuMakeMove(tlId, generation);
        if (!moved && generation === this.cpuGeneration) {
          console.warn('[CPU] No move made on timeline', tlId);
        }
      } catch (error) {
        console.error('[CPU] Error during move execution:', error);
      } finally {
        if (generation === this.cpuGeneration) this.cpuMoveInProgress = false;
      }
    }

    // A stop/start or reset while awaiting the engine invalidates this tick
    if (generation !== this.cpuGeneration || !this.cpuEnabled) return;
    if (this.cpuTurnQueue.length === 0) {
      this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
      this.cpuTurnQueue = null;
    }
    this._scheduleCpuTick();
  }

  private _scheduleCpuTick(): void {
    if (this.cpuTimer !== null) clearTimeout(this.cpuTimer);
    this.cpuTimer = window.setTimeout(() => this._cpuTick(), this.cpuMoveDelay);
  }

  /** Check if game is completely over - all timelines in checkmate, stalemate, or draw */
  private _cpuIsGameOver(): boolean {
    return Object.values(this.timelines).every((tl) => this.isTimelineFinished(tl));
  }

  /** Get all timelines where current color can play */
  private _cpuGetPlayableTimelines(): number[] {
    return Object.values(this.timelines)
      .filter((tl) => tl.chess.turn() === this.cpuGlobalTurn && !this.isTimelineFinished(tl))
      .map((tl) => tl.id);
  }

  /**
   * Evaluate material balance on a timeline (positive = white advantage)
   * Used for 5D-aware timeline prioritization
   */
  private _evaluateMaterial(fen: string): number {
    const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let score = 0;
    const boardPart = fen.split(' ')[0];
    for (const char of boardPart) {
      const piece = char.toLowerCase();
      if (pieceValues[piece] !== undefined) {
        const value = pieceValues[piece];
        score += char === char.toUpperCase() ? value : -value; // Upper = white
      }
    }
    return score;
  }

  /**
   * Pick the best timeline to play on (5D-aware selection)
   * Prioritizes timelines where:
   * - We have check opportunities
   * - We have material advantage (pressing)
   * - We're in danger (defending)
   */
  private _cpuSelectBestTimeline(playable: number[]): number {
    if (playable.length === 1) return playable[0];

    const isWhite = this.cpuGlobalTurn === 'w';
    let bestTlId = playable[0];
    let bestScore = -Infinity;
    const avgMoves = playable.reduce((sum, id) => sum + (this.timelines[id]?.moveHistory.length || 0), 0) / playable.length;

    for (const tlId of playable) {
      const tl = this.timelines[tlId];
      if (!tl) continue;

      let score = 0;
      const chess = tl.chess;
      const moves = chess.moves({ verbose: true }) as ChessMove[];
      // Check opportunities, being in check, captures
      if (moves.some((m) => m.san?.includes('+'))) score += 50;
      if (chess.in_check()) score += 40;
      score += moves.filter((m) => m.captured).length * 5;

      // Press an advantage or defend a weakness
      const material = this._evaluateMaterial(chess.fen());
      const advantage = isWhite ? material : -material;
      score += advantage > 0 ? advantage * 3 : Math.abs(advantage) * 2;

      // Balance play across boards (prefer less-played timelines)
      const moveCount = tl.moveHistory.length;
      if (moveCount < avgMoves * 0.5) score += 20;
      else if (moveCount < avgMoves * 0.8) score += 10;

      score += Math.random() * 5;
      if (score > bestScore) {
        bestScore = score;
        bestTlId = tlId;
      }
    }

    return bestTlId;
  }

  /** Make a CPU move on the given timeline. Returns true if a move was made. */
  private async _cpuMakeMove(tlId: number, generation: number): Promise<boolean> {
    const tl = this.timelines[tlId];
    if (!tl || tl.chess.turn() !== this.cpuGlobalTurn || this.isTimelineFinished(tl)) return false;

    const isWhite = tl.chess.turn() === 'w';
    const capturePreference = isWhite ? this.cpuWhiteCapturePreference : this.cpuBlackCapturePreference;

    if (this.activeTimelineId !== tlId) {
      this.setActiveTimeline(tlId, this.cpuCameraFollow);
    }

    const moves = tl.chess.moves({ verbose: true }) as ChessMove[];
    if (moves.length === 0) return false;

    Board3D.clearAllCpuPreviews();

    // Time travel opportunity (if under timeline limit)
    if (Object.keys(this.timelines).length < this.maxTimelines) {
      const tt = this._cpuCheckTimeTravel(tlId);
      if (tt && this._makeTimeTravelMove(tlId, tt.sourceSquare, tt.targetTurnIndex, tt.piece)) {
        this._flashCpuPreview(tlId, tt.sourceSquare, tt.sourceSquare, isWhite, true);
        return true;
      }
    }

    // Cross-timeline opportunity
    const cross = this._cpuCheckCrossTimeline(tlId);
    if (cross && this.makeCrossTimelineMove(tlId, cross.targetTimelineId, cross.sourceSquare, cross.targetSquare, cross.piece)) {
      this._flashCpuPreview(tlId, cross.sourceSquare, cross.targetSquare, isWhite, false);
      return true;
    }

    // Regular move: Stockfish if available, otherwise weighted random
    const fen = tl.chess.fen();
    const move = await this._selectCpuMove(fen, moves, capturePreference, isWhite);
    // Abort if the CPU was stopped/reset or the board changed while the engine was thinking
    if (!move || generation !== this.cpuGeneration || !this.timelines[tlId] || tl.chess.fen() !== fen) {
      return false;
    }
    if (!this.makeMove(tlId, move, move.promotion)) return false;
    this._flashCpuPreview(tlId, move.from, move.to, isWhite, false);
    return true;
  }

  private _flashCpuPreview(tlId: number, from: string, to: string, isWhite: boolean, isTimeTravel: boolean): void {
    const col = Board3D.getTimeline(tlId);
    if (!col) return;
    col.showCpuMovePreview(from, to, isWhite, isTimeTravel);
    window.setTimeout(() => col.clearCpuMovePreview(), 800);
  }

  /** Select a CPU move using Stockfish or random fallback */
  private async _selectCpuMove(
    fen: string,
    moves: ChessMove[],
    capturePreference: number,
    isWhite: boolean
  ): Promise<ChessMove | null> {
    if (this.cpuUseStockfish && stockfish.available) {
      try {
        stockfish.setSkillLevel(isWhite ? this.cpuStockfishSkillWhite : this.cpuStockfishSkillBlack);
        const sfMove = await stockfish.getBestMove(fen, this.cpuStockfishDepth);
        if (sfMove) {
          const promotion = sfMove.promotion || undefined;
          const matchingMove = moves.find(
            (m) => m.from === sfMove.from && m.to === sfMove.to && (!m.promotion || m.promotion === (promotion || 'q'))
          );
          if (matchingMove) return matchingMove;
        }
      } catch (error) {
        console.warn('[CPU] Stockfish error, falling back to random:', error);
      }
    }

    // Fallback: random legal move with a preference for captures
    const captures = moves.filter((m) => m.captured);
    const pool = captures.length > 0 && Math.random() < capturePreference ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Pick among scored multiverse candidates. Strong candidates (mate, check, rescuing a piece)
   * are played with the slider's probability; purposeless ones only rarely, for variety.
   */
  private _cpuPickMultiverseMove<T extends { score: number; bias: number }>(candidates: T[], chance: number): T | null {
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score || b.bias - a.bias);
    const best = candidates[0];
    if (best.score >= 1000) return best; // forced win on another board: always take it
    const strength = Math.min(1, Math.max(0, best.score) / 4);
    const probability = chance * (0.08 + 0.92 * strength) * (0.5 + best.bias);
    if (Math.random() >= probability) return null;
    // Choose randomly among equally good candidates to avoid repetitive play
    const top = candidates.filter((c) => c.score === best.score);
    return top[Math.floor(Math.random() * top.length)];
  }

  /** Check if CPU has a worthwhile time travel move on this timeline */
  private _cpuCheckTimeTravel(tlId: number): TimeTravelTarget & { sourceSquare: Square; piece: Piece } | null {
    const tl = this.timelines[tlId];
    if (!tl) return null;
    const color = tl.chess.turn();
    const biases = color === 'w' ? this.cpuWhitePortalBias : this.cpuBlackPortalBias;
    const sourceFen = tl.chess.fen();
    const candidates: Array<{ target: TimeTravelTarget; sourceSquare: Square; piece: Piece; score: number; bias: number }> = [];

    for (const [square, piece] of pieceMap(sourceFen)) {
      if (piece.color !== color || !canTimeTravel(piece.type)) continue;
      const bias = biases[piece.type] ?? 0;
      if (bias <= 0) continue;
      for (const target of this._getTimeTravelTargets(tlId, square, piece)) {
        const snapshotFen = this._getSnapshotFen(tl.snapshots[tl.snapshots.length - 2 - target.targetTurnIndex]);
        const plan = snapshotFen ? planTimeTravel(sourceFen, snapshotFen, square, piece) : null;
        if (!plan || !plan.ok) continue;
        const score = scoreMultiverseMove(sourceFen, square, plan.arrivalFen, square, piece, plan.captured);
        candidates.push({ target, sourceSquare: square, piece, score, bias });
      }
    }

    const pick = this._cpuPickMultiverseMove(candidates, this.cpuTimeTravelChance);
    return pick ? { ...pick.target, sourceSquare: pick.sourceSquare, piece: pick.piece } : null;
  }

  /** Check if CPU has a worthwhile cross-timeline move from this timeline */
  private _cpuCheckCrossTimeline(tlId: number): { targetTimelineId: number; sourceSquare: Square; targetSquare: Square; piece: Piece } | null {
    const tl = this.timelines[tlId];
    if (!tl || Object.keys(this.timelines).length < 2) return null;
    const color = tl.chess.turn();
    const biases = color === 'w' ? this.cpuWhitePortalBias : this.cpuBlackPortalBias;
    const sourceFen = tl.chess.fen();
    const sourceEval = this._evaluateMaterialBalance(tl.chess, color);
    const candidates: Array<{ targetTimelineId: number; sourceSquare: Square; targetSquare: Square; piece: Piece; score: number; bias: number }> = [];

    for (const [square, piece] of pieceMap(sourceFen)) {
      if (piece.color !== color || !canCrossTimelines(piece.type)) continue;
      const bias = biases[piece.type] ?? 0.1;
      if (bias <= 0) continue;
      for (const target of this.getCrossTimelineTargets(tlId, square, piece)) {
        const targetTl = this.timelines[target.targetTimelineId];
        const plan = planCrossTimelineMove(sourceFen, targetTl.chess.fen(), square, target.targetSquare, piece);
        if (!plan.ok) continue;
        let score = scoreMultiverseMove(sourceFen, square, plan.targetFen, target.targetSquare, piece);
        // Reinforce a board where we're behind using material from one where we're ahead
        const targetEval = this._evaluateMaterialBalance(targetTl.chess, color);
        if (sourceEval - targetEval >= 3 && score >= 0) score += 2;
        candidates.push({ targetTimelineId: target.targetTimelineId, sourceSquare: square, targetSquare: target.targetSquare, piece, score, bias });
      }
    }

    return this._cpuPickMultiverseMove(candidates, this.cpuCrossTimelineChance);
  }

  /** Evaluate material balance for a position (positive = color is winning) */
  private _evaluateMaterialBalance(chess: ChessInstance, color: PieceColor): number {
    const board = chess.board();
    const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

    let whiteScore = 0;
    let blackScore = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece) {
          const value = pieceValues[piece.type] || 0;
          if (piece.color === 'w') {
            whiteScore += value;
          } else {
            blackScore += value;
          }
        }
      }
    }

    // Return score relative to the specified color
    return color === 'w' ? whiteScore - blackScore : blackScore - whiteScore;
  }

  /** Update CPU UI elements */
  private _updateCpuUI(): void {
    const btn = document.getElementById('cpu-toggle');
    if (btn) {
      btn.textContent = this.cpuEnabled ? 'Stop CPU' : 'Start CPU';
      btn.classList.toggle('active', this.cpuEnabled);
    }

    const cameraBtn = document.getElementById('cpu-camera-toggle');
    if (cameraBtn) {
      // Keep the emoji icon, just update tooltip and active state
      cameraBtn.title = this.cpuCameraFollow ? 'Camera follow: ON (click to disable)' : 'Camera follow: OFF (click to enable)';
      cameraBtn.classList.toggle('active', this.cpuCameraFollow);
    }

    const whiteToggle = document.getElementById('cpu-white-toggle');
    if (whiteToggle) {
      whiteToggle.textContent = this.cpuWhiteEnabled ? 'ON' : 'OFF';
      whiteToggle.classList.toggle('active', this.cpuWhiteEnabled);
    }

    const blackToggle = document.getElementById('cpu-black-toggle');
    if (blackToggle) {
      blackToggle.textContent = this.cpuBlackEnabled ? 'ON' : 'OFF';
      blackToggle.classList.toggle('active', this.cpuBlackEnabled);
    }

    // Update Stockfish status and dumb mode toggle
    const stockfishStatus = document.getElementById('cpu-stockfish-status');
    const dumbToggle = document.getElementById('cpu-dumb-toggle');
    if (stockfishStatus) {
      if (!this.cpuUseStockfish) {
        stockfishStatus.textContent = 'Dumb Mode';
        stockfishStatus.classList.remove('ready');
        stockfishStatus.classList.add('dumb');
      } else if (stockfish.available) {
        stockfishStatus.textContent = 'Ready';
        stockfishStatus.classList.add('ready');
        stockfishStatus.classList.remove('error', 'dumb');
      } else {
        stockfishStatus.textContent = 'Loading...';
        stockfishStatus.classList.remove('ready', 'error', 'dumb');
      }
    }
    if (dumbToggle) {
      dumbToggle.textContent = this.cpuUseStockfish ? 'ON' : 'OFF';
      dumbToggle.classList.toggle('active', this.cpuUseStockfish);
      dumbToggle.title = this.cpuUseStockfish ? 'Stockfish enabled (click to disable)' : 'Stockfish disabled (click to enable)';
    }

    // Update 2D mode button
    this._update2DButtonUI();
  }

  /** Update 2D mode button UI state */
  private _update2DButtonUI(): void {
    const btn = document.getElementById('2d-mode-toggle');
    if (btn) {
      const is2D = Board3D.is2DMode();
      btn.title = is2D ? '2D view: ON (click for 3D)' : '2D view: OFF (click for 2D)';
      btn.classList.toggle('active', is2D);
    }
  }

  /** Set Stockfish skill level for White (0-20). Applied dynamically per-move in _selectCpuMove. */
  setStockfishSkillWhite(level: number): void {
    this.cpuStockfishSkillWhite = Math.max(0, Math.min(20, level));
  }

  /** Set Stockfish skill level for Black (0-20). Applied dynamically per-move in _selectCpuMove. */
  setStockfishSkillBlack(level: number): void {
    this.cpuStockfishSkillBlack = Math.max(0, Math.min(20, level));
  }

  /** Set Stockfish search depth (1-20) */
  setStockfishDepth(depth: number): void {
    this.cpuStockfishDepth = Math.max(1, Math.min(20, depth));
    stockfish.setSearchDepth(this.cpuStockfishDepth);
  }

  /** Toggle Stockfish usage */
  toggleStockfish(): void {
    this.cpuUseStockfish = !this.cpuUseStockfish;
    this._updateCpuUI();
  }

  /** Check if Stockfish is available */
  isStockfishAvailable(): boolean {
    return stockfish.available;
  }
}

// Export singleton instance
export const Game = new GameManager();
