
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Level extends Phaser.Scene {

	constructor() {
		super("Level");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// level.currency
		const level_currency = this.add.image(15.6, 21.1, "counter_frame_primary_currency");
		level_currency.scaleX = 1.248;
		level_currency.scaleY = 0.5486;
		level_currency.setOrigin(0, 0);

		// level.label
		const level_label = this.add.text(195, 21.1, "", {});
		level_label.setOrigin(0.5, 0);
		level_label.text = "Level";
		level_label.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// level.pause
		const level_pause = this.add.image(374.4, 21.1, "icon_control_pause");
		level_pause.scaleX = 0.546;
		level_pause.scaleY = 0.5908;
		level_pause.setOrigin(1, 0);

		// level.gameplay-region
		const level_gameplay_region = this.add.container(195, 422);

		// level.test-win
		const level_test_win = this.add.text(11.7, 827.12, "", {});
		level_test_win.setOrigin(0, 1);
		level_test_win.text = "Test Win";
		level_test_win.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// level.test-lose
		const level_test_lose = this.add.text(378.3, 827.12, "", {});
		level_test_lose.setOrigin(1, 1);
		level_test_lose.text = "Test Lose";
		level_test_lose.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// level_currency (components)
		const level_currencySemantic = new Semantic(level_currency);
		level_currencySemantic.fabSemanticId = "level.currency";
		level_currencySemantic.fabRole = "currency-counter";
		level_currencySemantic.fabBinding = "state.primary-currency";
		level_currencySemantic.fabSlot = "counter-frame";
		level_currencySemantic.fabVariant = "default";

		// level_label (components)
		const level_labelSemantic = new Semantic(level_label);
		level_labelSemantic.fabSemanticId = "level.label";
		level_labelSemantic.fabRole = "level-label";
		level_labelSemantic.fabBinding = "state.level-label";
		level_labelSemantic.fabVariant = "default";

		// level_pause (components)
		const level_pauseSemantic = new Semantic(level_pause);
		level_pauseSemantic.fabSemanticId = "level.pause";
		level_pauseSemantic.fabRole = "top-icon-action";
		level_pauseSemantic.fabBinding = "flow.pause";
		level_pauseSemantic.fabSlot = "icon-control";
		level_pauseSemantic.fabVariant = "default";

		// level_gameplay_region (components)
		const level_gameplay_regionSemantic = new Semantic(level_gameplay_region);
		level_gameplay_regionSemantic.fabSemanticId = "level.gameplay-region";
		level_gameplay_regionSemantic.fabRole = "gameplay-region";
		level_gameplay_regionSemantic.fabBinding = "mechanic.mount";
		level_gameplay_regionSemantic.fabSlot = "gameplay-background";
		level_gameplay_regionSemantic.fabVariant = "default";

		// level_test_win (components)
		const level_test_winSemantic = new Semantic(level_test_win);
		level_test_winSemantic.fabSemanticId = "level.test-win";
		level_test_winSemantic.fabRole = "bottom-left-test-action";
		level_test_winSemantic.fabBinding = "flow.test-win";
		level_test_winSemantic.fabSlot = "button-surface";
		level_test_winSemantic.fabVariant = "default";

		// level_test_lose (components)
		const level_test_loseSemantic = new Semantic(level_test_lose);
		level_test_loseSemantic.fabSemanticId = "level.test-lose";
		level_test_loseSemantic.fabRole = "bottom-right-test-action";
		level_test_loseSemantic.fabBinding = "flow.test-lose";
		level_test_loseSemantic.fabSlot = "button-surface";
		level_test_loseSemantic.fabVariant = "default";

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
