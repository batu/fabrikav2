
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Probe extends Phaser.Scene {

	constructor() {
		super("Probe");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	editorCreate(): void {

		// hudSafeTop
		const hudSafeTop = this.add.text(360, 40, "", {});
		hudSafeTop.setOrigin(0.5, 0.5);
		hudSafeTop.text = "SAFE-TOP";
		hudSafeTop.setStyle({ "align": "center", "color": "#9ad1ff", "fontFamily": "Arial", "fontSize": "24px" });

		// copyTitle
		const copyTitle = this.add.text(360, 140, "", {});
		copyTitle.setOrigin(0.5, 0.5);
		copyTitle.text = "PROBE-43QVBIH7";
		copyTitle.setStyle({ "align": "center", "color": "#ffffff", "fontFamily": "Arial", "fontSize": "48px" });

		// badgeBlue
		const badgeBlue = this.add.image(360, 260, "badge_blue");

		// panelRoot
		const panelRoot = this.add.container(360, 640);

		// counterPrimary
		const counterPrimary = this.add.text(0, -180, "", {});
		counterPrimary.setOrigin(0.5, 0.5);
		counterPrimary.text = "0";
		counterPrimary.setStyle({ "align": "center", "color": "#ffe28a", "fontFamily": "Arial", "fontSize": "40px" });
		panelRoot.add(counterPrimary);

		// actionPlay
		const actionPlay = this.add.image(0, 0, "button_play");
		panelRoot.add(actionPlay);

		// actionPlayPressed
		const actionPlayPressed = this.add.image(0, 140, "button_play");
		actionPlayPressed.scaleX = 0.85;
		actionPlayPressed.scaleY = 0.85;
		panelRoot.add(actionPlayPressed);

		// counterPrimary_1
		const counterPrimary_1 = this.add.text(-360, -820, "", {});
		counterPrimary_1.setOrigin(0.5, 0.5);
		counterPrimary_1.text = "0";
		counterPrimary_1.setStyle({ "align": "center", "color": "#ffe28a", "fontFamily": "Arial", "fontSize": "40px" });
		panelRoot.add(counterPrimary_1);

		// copyHostile
		const copyHostile = this.add.text(360, 1120, "", {});
		copyHostile.setOrigin(0.5, 0.5);
		copyHostile.text = "H' H\" H` ${x} {y} */ // <\/script>\nline2";
		copyHostile.setStyle({ "align": "center", "color": "#ff9a9a", "fontFamily": "Arial", "fontSize": "24px" });

		// hudSafeTop (components)
		const hudSafeTopSemantic = new Semantic(hudSafeTop);
		hudSafeTopSemantic.fabSemanticId = "shell.hud.safeTop";
		hudSafeTopSemantic.fabRole = "hud";
		hudSafeTopSemantic.fabBinding = "copy:safeTop";
		hudSafeTopSemantic.fabSlot = "safe-area:top";

		// copyTitle (components)
		const copyTitleSemantic = new Semantic(copyTitle);
		copyTitleSemantic.fabSemanticId = "shell.copy.title";
		copyTitleSemantic.fabRole = "copy";
		copyTitleSemantic.fabBinding = "copy:title";

		// badgeBlue (components)
		const badgeBlueSemantic = new Semantic(badgeBlue);
		badgeBlueSemantic.fabSemanticId = "shell.badge.catalog";
		badgeBlueSemantic.fabRole = "asset";
		badgeBlueSemantic.fabBinding = "asset:cat.badge.blue";

		// panelRoot (components)
		const panelRootSemantic = new Semantic(panelRoot);
		panelRootSemantic.fabSemanticId = "shell.panel.root";
		panelRootSemantic.fabRole = "container";
		panelRootSemantic.fabSlot = "content";

		// counterPrimary (components)
		const counterPrimarySemantic = new Semantic(counterPrimary);
		counterPrimarySemantic.fabSemanticId = "shell.counter.primary";
		counterPrimarySemantic.fabRole = "counter";
		counterPrimarySemantic.fabBinding = "currency:primary";

		// actionPlay (components)
		const actionPlaySemantic = new Semantic(actionPlay);
		actionPlaySemantic.fabSemanticId = "shell.action.play";
		actionPlaySemantic.fabRole = "action";
		actionPlaySemantic.fabBinding = "action:play";
		actionPlaySemantic.fabVariant = "default";

		// actionPlayPressed (components)
		const actionPlayPressedSemantic = new Semantic(actionPlayPressed);
		actionPlayPressedSemantic.fabSemanticId = "shell.action.play";
		actionPlayPressedSemantic.fabRole = "action";
		actionPlayPressedSemantic.fabBinding = "action:play";
		actionPlayPressedSemantic.fabVariant = "pressed";

		// counterPrimary_1 (components)
		const counterPrimary_1Semantic = new Semantic(counterPrimary_1);
		counterPrimary_1Semantic.fabSemanticId = "shell.counter.secondary";
		counterPrimary_1Semantic.fabRole = "counter";
		counterPrimary_1Semantic.fabBinding = "currency:secondary";

		// copyHostile (components)
		const copyHostileSemantic = new Semantic(copyHostile);
		copyHostileSemantic.fabSemanticId = "shell.copy.hostile";
		copyHostileSemantic.fabRole = "copy";
		copyHostileSemantic.fabBinding = "copy:hostile";
		copyHostileSemantic.fabSlot = "slot'\"`${}*/-//-<\/script>";

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
