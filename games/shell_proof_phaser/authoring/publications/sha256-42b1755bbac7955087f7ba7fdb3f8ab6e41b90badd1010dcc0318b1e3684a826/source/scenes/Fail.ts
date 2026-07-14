
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

		// fail.fab.backdrop
		const fail_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		fail_fab_backdrop.isFilled = true;
		fail_fab_backdrop.fillColor = 16250607;

		// fail.fab.gameplay-card
		const fail_fab_gameplay_card = this.add.rectangle(195, 370, 350, 620);
		fail_fab_gameplay_card.isFilled = true;
		fail_fab_gameplay_card.fillColor = 14479088;
		fail_fab_gameplay_card.setRounded(28);

		// fail.fab.context-level
		const fail_fab_context_level = this.add.text(195, 84, "", {});
		fail_fab_context_level.setOrigin(0.5, 0.5);
		fail_fab_context_level.text = "TRAIL 2";
		fail_fab_context_level.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "18px" });

		// fail.fab.context-prompt
		const fail_fab_context_prompt = this.add.rectangle(195, 180, 300, 112);
		fail_fab_context_prompt.isFilled = true;
		fail_fab_context_prompt.isStroked = true;
		fail_fab_context_prompt.strokeColor = 11257804;
		fail_fab_context_prompt.lineWidth = 2;
		fail_fab_context_prompt.setRounded(22);

		// fail.fab.context-eyebrow
		const fail_fab_context_eyebrow = this.add.text(72, 154, "", {});
		fail_fab_context_eyebrow.setOrigin(0, 0.5);
		fail_fab_context_eyebrow.text = "TRAIL CLEARING";
		fail_fab_context_eyebrow.setStyle({ "color": "#1f765d", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// fail.fab.context-copy
		const fail_fab_context_copy = this.add.text(72, 194, "", {});
		fail_fab_context_copy.setOrigin(0, 0.5);
		fail_fab_context_copy.text = "A calm path opens ahead.";
		fail_fab_context_copy.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// fail.fab.context-sun
		const fail_fab_context_sun = this.add.rectangle(306, 318, 48, 48);
		fail_fab_context_sun.isFilled = true;
		fail_fab_context_sun.fillColor = 16772514;
		fail_fab_context_sun.setRounded(24);

		// fail.fab.context-hill
		const fail_fab_context_hill = this.add.rectangle(278, 590, 188, 112);
		fail_fab_context_hill.isFilled = true;
		fail_fab_context_hill.fillColor = 6137727;
		fail_fab_context_hill.setRounded(56);

		// fail.fab.scrim
		const fail_fab_scrim = this.add.rectangle(195, 422, 390, 844);
		fail_fab_scrim.isFilled = true;
		fail_fab_scrim.fillColor = 1583670;
		fail_fab_scrim.fillAlpha = 0.52;

		// fail.fab.card
		const fail_fab_card = this.add.rectangle(195, 844, 390, 454);
		fail_fab_card.setOrigin(0.5, 1);
		fail_fab_card.isFilled = true;
		fail_fab_card.fillColor = 16774879;
		fail_fab_card.isStroked = true;
		fail_fab_card.strokeColor = 11095878;
		fail_fab_card.lineWidth = 2;
		fail_fab_card.setRounded(28);

		// fail.fab.handle
		const fail_fab_handle = this.add.rectangle(195, 402, 48, 5);
		fail_fab_handle.isFilled = true;
		fail_fab_handle.fillColor = 11095878;
		fail_fab_handle.setRounded(3);

		// fail.fab.header-shadow
		const fail_fab_header_shadow = this.add.rectangle(1, 1, 1, 1);
		fail_fab_header_shadow.isFilled = true;
		fail_fab_header_shadow.fillColor = 16250607;
		fail_fab_header_shadow.fillAlpha = 0;
		fail_fab_header_shadow.setRounded(22);

		// fail.fab.header
		const fail_fab_header = this.add.rectangle(1, 1, 1, 1);
		fail_fab_header.isFilled = true;
		fail_fab_header.fillColor = 16250607;
		fail_fab_header.fillAlpha = 0;
		fail_fab_header.isStroked = true;
		fail_fab_header.strokeColor = 11095878;
		fail_fab_header.lineWidth = 2;
		fail_fab_header.setRounded(22);

		// fail.fab.result-medal
		const fail_fab_result_medal = this.add.rectangle(346, 438, 56, 56);
		fail_fab_result_medal.isFilled = true;
		fail_fab_result_medal.fillColor = 11095878;
		fail_fab_result_medal.setRounded(28);

		// fail.fab.result-icon
		const fail_fab_result_icon = this.add.image(346, 438, "icon_control_result_fail");
		fail_fab_result_icon.scaleX = 0.3;
		fail_fab_result_icon.scaleY = 0.3;

		// fail.fab.counter
		const fail_fab_counter = this.add.rectangle(85, 490, 220, 56);
		fail_fab_counter.setOrigin(0, 0);
		fail_fab_counter.isFilled = true;
		fail_fab_counter.fillColor = 1519682;
		fail_fab_counter.isStroked = true;
		fail_fab_counter.strokeColor = 3563376;
		fail_fab_counter.strokeAlpha = 0.65;
		fail_fab_counter.lineWidth = 2;
		fail_fab_counter.setRounded(28);

		// fail.fab.balance
		const fail_fab_balance = this.add.text(222, 518, "", {});
		fail_fab_balance.setOrigin(0.5, 0.5);
		fail_fab_balance.text = "25 Coins";
		fail_fab_balance.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "18px" });

		// fail.fab.explainer
		const fail_fab_explainer = this.add.text(195, 568, "", {});
		fail_fab_explainer.setOrigin(0.5, 0.5);
		fail_fab_explainer.text = "Choose a step and retry.";
		fail_fab_explainer.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// fail.fab.continue-control
		const fail_fab_continue_control = this.add.rectangle(195, 628, 338, 60);
		fail_fab_continue_control.isFilled = true;
		fail_fab_continue_control.fillColor = 1339983;
		fail_fab_continue_control.setRounded(20);

		// fail.fab.retry-control
		const fail_fab_retry_control = this.add.rectangle(195, 698, 338, 58);
		fail_fab_retry_control.isFilled = true;
		fail_fab_retry_control.fillColor = 14216932;
		fail_fab_retry_control.isStroked = true;
		fail_fab_retry_control.strokeColor = 2061917;
		fail_fab_retry_control.lineWidth = 2;
		fail_fab_retry_control.setRounded(20);

		// fail.fab.bundle-divider
		const fail_fab_bundle_divider = this.add.rectangle(195, 739, 306, 2);
		fail_fab_bundle_divider.isFilled = true;
		fail_fab_bundle_divider.fillColor = 11095878;
		fail_fab_bundle_divider.fillAlpha = 0.4;

		// fail.fab.bundle-control
		const fail_fab_bundle_control = this.add.rectangle(195, 781, 306, 58);
		fail_fab_bundle_control.isFilled = true;
		fail_fab_bundle_control.fillColor = 16244436;
		fail_fab_bundle_control.isStroked = true;
		fail_fab_bundle_control.strokeColor = 13138018;
		fail_fab_bundle_control.strokeAlpha = 0.75;
		fail_fab_bundle_control.lineWidth = 2;
		fail_fab_bundle_control.setRounded(20);

		// fail.fab.retry-surface
		const fail_fab_retry_surface = this.add.image(195, 727, "button_surface_primary");
		fail_fab_retry_surface.scaleX = 0.01;
		fail_fab_retry_surface.scaleY = 0.01;
		fail_fab_retry_surface.setOrigin(0.5, 1);
		fail_fab_retry_surface.visible = false;

		// fail.fab.continue-surface
		const fail_fab_continue_surface = this.add.image(195, 658, "button_surface_secondary");
		fail_fab_continue_surface.scaleX = 0.01;
		fail_fab_continue_surface.scaleY = 0.01;
		fail_fab_continue_surface.setOrigin(0.5, 1);
		fail_fab_continue_surface.visible = false;

		// fail.fab.bundle-surface
		const fail_fab_bundle_surface = this.add.image(195, 824, "button_surface_secondary");
		fail_fab_bundle_surface.scaleX = 0.01;
		fail_fab_bundle_surface.scaleY = 0.01;
		fail_fab_bundle_surface.setOrigin(0.5, 1);
		fail_fab_bundle_surface.visible = false;

		// fail.panel
		const fail_panel = this.add.text(195, 438, "", {});
		fail_panel.setOrigin(0.5, 0.5);
		fail_panel.text = "Trail Blocked";
		fail_panel.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "20px" });

		// fail.currency
		const fail_currency = this.add.image(98, 504, "counter_frame_primary_currency");
		fail_currency.scaleX = 0.32;
		fail_currency.scaleY = 0.32;
		fail_currency.setOrigin(0, 0);

		// fail.continue-coins
		const fail_continue_coins = this.add.text(195, 643, "", {});
		fail_continue_coins.setOrigin(0.5, 1);
		fail_continue_coins.text = "Continue · 10 Coins";
		fail_continue_coins.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "19px" });

		// fail.bundle
		const fail_bundle = this.add.text(195, 792, "", {});
		fail_bundle.setOrigin(0.5, 1);
		fail_bundle.text = "Rescue bundle · $4.99\nContinue this level";
		fail_bundle.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// fail.retry
		const fail_retry = this.add.text(195, 713, "", {});
		fail_retry.setOrigin(0.5, 1);
		fail_retry.text = "Retry";
		fail_retry.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

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
