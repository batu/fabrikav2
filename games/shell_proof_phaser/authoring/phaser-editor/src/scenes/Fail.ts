
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Fail extends Phaser.Scene {

	constructor() {
		super("Fail");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// fail.panel
		const fail_panel = this.add.text(195, 422, "", {});
		fail_panel.setOrigin(0.5, 0.5);
		fail_panel.text = "Try Again";
		fail_panel.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// fail.currency
		const fail_currency = this.add.image(15.6, 92.84, "counter_frame_primary_currency");
		fail_currency.scaleX = 1.248;
		fail_currency.scaleY = 0.5486;
		fail_currency.setOrigin(0, 0);

		// fail.continue-coins
		const fail_continue_coins = this.add.text(195, 607.68, "", {});
		fail_continue_coins.setOrigin(0.5, 1);
		fail_continue_coins.text = "Continue";
		fail_continue_coins.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// fail.bundle
		const fail_bundle = this.add.text(195, 776.48, "", {});
		fail_bundle.setOrigin(0.5, 1);
		fail_bundle.text = "Bundle";
		fail_bundle.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// fail.retry
		const fail_retry = this.add.text(195, 692.08, "", {});
		fail_retry.setOrigin(0.5, 1);
		fail_retry.text = "Retry";
		fail_retry.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// fail_panel (components)
		const fail_panelSemantic = new Semantic(fail_panel);
		fail_panelSemantic.fabSemanticId = "fail.panel";
		fail_panelSemantic.fabRole = "result-panel";
		fail_panelSemantic.fabBinding = "presentation.static";
		fail_panelSemantic.fabSlot = "modal-frame";
		fail_panelSemantic.fabVariant = "default";

		// fail_currency (components)
		const fail_currencySemantic = new Semantic(fail_currency);
		fail_currencySemantic.fabSemanticId = "fail.currency";
		fail_currencySemantic.fabRole = "currency-counter";
		fail_currencySemantic.fabBinding = "state.primary-currency";
		fail_currencySemantic.fabSlot = "counter-frame";
		fail_currencySemantic.fabVariant = "default";

		// fail_continue_coins (components)
		const fail_continue_coinsSemantic = new Semantic(fail_continue_coins);
		fail_continue_coinsSemantic.fabSemanticId = "fail.continue-coins";
		fail_continue_coinsSemantic.fabRole = "bottom-secondary-action";
		fail_continue_coinsSemantic.fabBinding = "flow.continue-coins";
		fail_continue_coinsSemantic.fabSlot = "button-surface";
		fail_continue_coinsSemantic.fabVariant = "default";

		// fail_bundle (components)
		const fail_bundleSemantic = new Semantic(fail_bundle);
		fail_bundleSemantic.fabSemanticId = "fail.bundle";
		fail_bundleSemantic.fabRole = "bottom-secondary-action";
		fail_bundleSemantic.fabBinding = "commerce.bundle";
		fail_bundleSemantic.fabSlot = "button-surface";
		fail_bundleSemantic.fabVariant = "default";

		// fail_retry (components)
		const fail_retrySemantic = new Semantic(fail_retry);
		fail_retrySemantic.fabSemanticId = "fail.retry";
		fail_retrySemantic.fabRole = "bottom-primary-action";
		fail_retrySemantic.fabBinding = "flow.retry";
		fail_retrySemantic.fabSlot = "button-surface";
		fail_retrySemantic.fabVariant = "default";

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
