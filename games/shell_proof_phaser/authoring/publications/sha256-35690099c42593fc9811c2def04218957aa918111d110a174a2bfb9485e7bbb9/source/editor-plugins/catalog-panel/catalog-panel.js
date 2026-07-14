// Fabrikav2 U5 authoring catalog panel (P2/P6, R9, KTD-C/KTD-E). The native
// Phaser Editor asset tray surfaces pack keys only (U2 finding); R9 requires the
// full curated metadata — id, human name, purpose, slot compatibility, source
// dimensions, alpha policy, provenance/license — to be VISIBLE while authoring.
// This authoring-only plugin renders that metadata for every curated entry in a
// read-only, toggleable overlay panel that never replaces a native pane.
//
// It is NETWORK-FREE, STORAGE-FREE and EVAL-FREE: the metadata is an embedded
// deterministic snapshot (no network read — catalog.json is a sibling of the
// Editor project the panel cannot reach), and a focused test parses this
// snapshot and proves it EXACTLY equals canonical catalog.json, so any drift
// fails the build. It builds DOM with createElement/textContent only — no
// innerHTML, no dynamic code — and exposes a probe for real-Editor evidence.
(() => {
  // Embedded R9 snapshot — proven equal to
  // games/shell_proof_phaser/authoring/catalog/catalog.json by the focused test.
  const CATALOG = [
    {
      "id": "button-surface.primary",
      "name": "Primary action surface",
      "purpose": "Green rounded rectangle surface used behind the template's primary shell action labels.",
      "slotId": "button-surface",
      "slotCompatibility": ["bottom-primary-action", "bottom-secondary-action", "bottom-left-test-action", "bottom-right-test-action"],
      "dimensions": {
        "width": 384,
        "height": 128
      },
      "alphaPolicy": "allowed",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Green/Double/button_rectangle_depth_gradient.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "button-surface.secondary",
      "name": "Secondary action surface",
      "purpose": "Blue rounded rectangle surface used behind the template's secondary shell action labels.",
      "slotId": "button-surface",
      "slotCompatibility": ["bottom-primary-action", "bottom-secondary-action", "bottom-left-test-action", "bottom-right-test-action"],
      "dimensions": {
        "width": 384,
        "height": 128
      },
      "alphaPolicy": "allowed",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Blue/Double/button_rectangle_depth_gradient.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "button-surface.test-lose",
      "name": "Test lose action surface",
      "purpose": "Blue bordered rectangle surface used by the template's deterministic lose test action.",
      "slotId": "button-surface",
      "slotCompatibility": ["bottom-primary-action", "bottom-secondary-action", "bottom-left-test-action", "bottom-right-test-action"],
      "dimensions": {
        "width": 384,
        "height": 128
      },
      "alphaPolicy": "allowed",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Blue/Double/button_rectangle_depth_border.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "button-surface.test-win",
      "name": "Test win action surface",
      "purpose": "Green flat rectangle surface used by the template's deterministic win test action.",
      "slotId": "button-surface",
      "slotCompatibility": ["bottom-primary-action", "bottom-secondary-action", "bottom-left-test-action", "bottom-right-test-action"],
      "dimensions": {
        "width": 384,
        "height": 128
      },
      "alphaPolicy": "allowed",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Green/Double/button_rectangle_depth_flat.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "counter-frame.primary-currency",
      "name": "Primary currency marker",
      "purpose": "White star glyph used inside the primary currency counter to identify its displayed value.",
      "slotId": "counter-frame",
      "slotCompatibility": ["currency-counter"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "allowed",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/star.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.back",
      "name": "Back icon",
      "purpose": "White previous-arrow glyph used inside a shell icon control that navigates backward.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/previous.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.confirm",
      "name": "Confirm icon",
      "purpose": "White checkmark glyph used inside a shell icon control to confirm a visible choice.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/checkmark.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.haptics",
      "name": "Haptics icon",
      "purpose": "White gamepad glyph used inside a shell icon control for the haptics preference.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/gamepad.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.home",
      "name": "Home icon",
      "purpose": "White house glyph used inside a shell icon control that returns to the home menu.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/home.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.music-off",
      "name": "Music off icon",
      "purpose": "White muted-music glyph used inside a shell icon control for disabled music.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/musicOff.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.music-on",
      "name": "Music on icon",
      "purpose": "White music glyph used inside a shell icon control for enabled background music.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/musicOn.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.next",
      "name": "Next icon",
      "purpose": "White forward-arrow glyph used inside a shell icon control that advances to the next step.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/next.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.pause",
      "name": "Pause icon",
      "purpose": "White pause glyph used inside the shell icon control that pauses active gameplay.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/pause.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.play",
      "name": "Play icon",
      "purpose": "Light play-arrow glyph used inside a shell icon control that starts or resumes play.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 60,
        "height": 68
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Extra/Double/icon_play_light.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.result-fail",
      "name": "Failure result icon",
      "purpose": "White cross glyph used inside the shell's failure result icon control.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/cross.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.result-win",
      "name": "Victory result icon",
      "purpose": "White trophy glyph used inside the shell's victory result icon control.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/trophy.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.retry",
      "name": "Retry icon",
      "purpose": "Light repeat-arrow glyph used inside a shell icon control that restarts an attempt.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 82,
        "height": 72
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Extra/Double/icon_repeat_light.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.return",
      "name": "Return icon",
      "purpose": "White return-arrow glyph used inside a shell icon control that leaves the current view.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/return.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.settings",
      "name": "Settings icon",
      "purpose": "White gear glyph used inside the shell icon control that opens game settings.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/gear.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.shop",
      "name": "Shop icon",
      "purpose": "White shopping-cart glyph used inside the shell icon control that opens the Shop page.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/shoppingCart.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "icon-control.surface",
      "name": "Icon control surface",
      "purpose": "Blue square button surface used behind a standalone top-bar shell icon control.",
      "slotId": "icon-control",
      "slotCompatibility": ["top-icon-action", "header-back-action"],
      "dimensions": {
        "width": 128,
        "height": 128
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Blue/Double/button_square_depth_gradient.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "progression-node.completed",
      "name": "Completed progression node",
      "purpose": "White unlocked glyph used to identify a completed node in the shell's progression path.",
      "slotId": "progression-node",
      "slotCompatibility": ["progression-node"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/unlocked.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "progression-node.current",
      "name": "Current progression node",
      "purpose": "Green round button surface used to identify the current node in the shell's progression path.",
      "slotId": "progression-node",
      "slotCompatibility": ["progression-node"],
      "dimensions": {
        "width": 128,
        "height": 128
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-ui-pack-2.0",
        "sourcePath": "PNG/Green/Double/button_round_depth_gradient.png",
        "license": "CC0-1.0"
      }
    },
    {
      "id": "progression-node.locked",
      "name": "Locked progression node",
      "purpose": "White lock glyph used to identify an unavailable node in the shell's progression path.",
      "slotId": "progression-node",
      "slotCompatibility": ["progression-node"],
      "dimensions": {
        "width": 100,
        "height": 100
      },
      "alphaPolicy": "required",
      "provenance": {
        "sourceId": "kenney-game-icons-1.0",
        "sourcePath": "PNG/White/2x/locked.png",
        "license": "CC0-1.0"
      }
    }
  ];

  const doc = document;
  const host = doc.body || doc.documentElement;

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const field = (parent, label, value) => {
    const row = el('div', 'fab-catalog-field');
    row.appendChild(el('span', 'fab-catalog-field-label', label));
    row.appendChild(el('span', 'fab-catalog-field-value', value));
    parent.appendChild(row);
    return row;
  };

  const buildCard = (entry) => {
    const card = el('div', 'fab-catalog-card');
    Object.assign(card.style, {
      padding: '12px',
      border: '1px solid #4b5563',
      borderRadius: '8px',
      background: '#273449',
      color: '#f8fafc',
    });
    card.setAttribute('data-catalog-id', entry.id);
    card.appendChild(el('div', 'fab-catalog-id', entry.id));
    card.appendChild(el('div', 'fab-catalog-name', entry.name));
    card.appendChild(el('div', 'fab-catalog-purpose', entry.purpose));
    field(card, 'Slot', entry.slotId);
    field(card, 'Compatible roles', entry.slotCompatibility.join(', '));
    field(card, 'Dimensions', `${entry.dimensions.width} × ${entry.dimensions.height}`);
    field(card, 'Alpha policy', entry.alphaPolicy);
    field(
      card,
      'Provenance',
      `${entry.provenance.sourceId} — ${entry.provenance.sourcePath} (${entry.provenance.license})`,
    );
    return card;
  };

  const panel = el('aside', 'fab-catalog-panel');
  panel.id = 'fab-catalog-panel';
  panel.setAttribute('aria-label', 'Curated asset catalog (read-only)');
  Object.assign(panel.style, {
    display: 'none',
    position: 'fixed',
    top: '52px',
    right: '12px',
    width: '420px',
    maxWidth: 'calc(100vw - 24px)',
    height: 'calc(100vh - 72px)',
    maxHeight: '820px',
    overflow: 'hidden',
    flexDirection: 'column',
    boxSizing: 'border-box',
    border: '1px solid #64748b',
    borderRadius: '10px',
    background: '#111827',
    color: '#f8fafc',
    boxShadow: '0 18px 48px rgba(0, 0, 0, 0.55)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '12px',
    zIndex: '2147483646',
  });
  const header = el('header', 'fab-catalog-header', `Curated asset catalog — ${CATALOG.length} entries`);
  Object.assign(header.style, {
    flex: '0 0 auto',
    padding: '14px 16px',
    borderBottom: '1px solid #475569',
    background: '#1e293b',
    fontSize: '14px',
    fontWeight: '700',
  });
  panel.appendChild(header);
  const list = el('div', 'fab-catalog-list');
  Object.assign(list.style, {
    flex: '1 1 auto',
    minHeight: '0',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'grid',
    gap: '10px',
    padding: '12px',
  });
  for (const entry of CATALOG) list.appendChild(buildCard(entry));
  panel.appendChild(list);

  const toggle = el('button', 'fab-catalog-toggle', 'Catalog');
  toggle.id = 'fab-catalog-panel-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', panel.id);
  Object.assign(toggle.style, {
    position: 'fixed',
    top: '10px',
    right: '12px',
    minWidth: '92px',
    minHeight: '34px',
    padding: '7px 12px',
    border: '1px solid #7dd3fc',
    borderRadius: '7px',
    background: '#0f172a',
    color: '#f8fafc',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    zIndex: '2147483647',
  });

  const isOpen = () => panel.style.display !== 'none';
  const setOpen = (open) => {
    panel.style.display = open ? 'flex' : 'none';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => setOpen(!isOpen()));
  setOpen(false);

  host.appendChild(toggle);
  host.appendChild(panel);

  const probe = {
    loaded: true,
    entryCount: CATALOG.length,
    entries: CATALOG,
    panelId: panel.id,
    toggleId: toggle.id,
    isOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    // Ids visibly rendered in the panel, for real-Editor evidence.
    renderedIds: () => CATALOG.map((entry) => entry.id),
  };

  Object.defineProperties(globalThis, {
    __catalogPanelPluginLoaded: { value: true, configurable: true },
    __catalogPanelPluginProbe: { value: probe, configurable: true },
  });
})();
