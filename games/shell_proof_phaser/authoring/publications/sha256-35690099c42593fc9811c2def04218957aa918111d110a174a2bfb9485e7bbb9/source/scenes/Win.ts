
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Win extends Phaser.Scene {

	constructor() {
		super("Win");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// win.fab.backdrop
		const win_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		win_fab_backdrop.isFilled = true;
		win_fab_backdrop.fillColor = 16250607;

		// win.fab.gameplay-card
		const win_fab_gameplay_card = this.add.rectangle(195, 370, 350, 620);
		win_fab_gameplay_card.isFilled = true;
		win_fab_gameplay_card.fillColor = 14479088;
		win_fab_gameplay_card.setRounded(28);

		// win.fab.context-level
		const win_fab_context_level = this.add.text(195, 84, "", {});
		win_fab_context_level.setOrigin(0.5, 0.5);
		win_fab_context_level.text = "TRAIL 2";
		win_fab_context_level.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "18px" });

		// win.fab.context-prompt
		const win_fab_context_prompt = this.add.rectangle(195, 180, 300, 112);
		win_fab_context_prompt.isFilled = true;
		win_fab_context_prompt.isStroked = true;
		win_fab_context_prompt.strokeColor = 11257804;
		win_fab_context_prompt.lineWidth = 2;
		win_fab_context_prompt.setRounded(22);

		// win.fab.context-eyebrow
		const win_fab_context_eyebrow = this.add.text(72, 154, "", {});
		win_fab_context_eyebrow.setOrigin(0, 0.5);
		win_fab_context_eyebrow.text = "NEXT STEP";
		win_fab_context_eyebrow.setStyle({ "color": "#1f765d", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// win.fab.context-copy
		const win_fab_context_copy = this.add.text(72, 194, "", {});
		win_fab_context_copy.setOrigin(0, 0.5);
		win_fab_context_copy.text = "A calm path opens ahead.";
		win_fab_context_copy.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// win.fab.context-sun
		const win_fab_context_sun = this.add.rectangle(306, 318, 48, 48);
		win_fab_context_sun.isFilled = true;
		win_fab_context_sun.fillColor = 16772514;
		win_fab_context_sun.setRounded(24);

		// win.fab.context-hill
		const win_fab_context_hill = this.add.rectangle(278, 590, 188, 112);
		win_fab_context_hill.isFilled = true;
		win_fab_context_hill.fillColor = 6137727;
		win_fab_context_hill.setRounded(56);

		// win.fab.scrim
		const win_fab_scrim = this.add.rectangle(195, 422, 390, 844);
		win_fab_scrim.isFilled = true;
		win_fab_scrim.fillColor = 1583670;
		win_fab_scrim.fillAlpha = 0.52;

		// win.fab.card
		const win_fab_card = this.add.rectangle(195, 450, 354, 520);
		win_fab_card.isFilled = true;
		win_fab_card.fillColor = 16774879;
		win_fab_card.isStroked = true;
		win_fab_card.strokeColor = 2061917;
		win_fab_card.strokeAlpha = 0.8;
		win_fab_card.lineWidth = 2;
		win_fab_card.setRounded(28);

		// win.fab.header-shadow
		const win_fab_header_shadow = this.add.rectangle(1, 1, 1, 1);
		win_fab_header_shadow.isFilled = true;
		win_fab_header_shadow.fillColor = 16250607;
		win_fab_header_shadow.fillAlpha = 0;
		win_fab_header_shadow.setRounded(22);

		// win.fab.header
		const win_fab_header = this.add.rectangle(1, 1, 1, 1);
		win_fab_header.isFilled = true;
		win_fab_header.fillColor = 16250607;
		win_fab_header.fillAlpha = 0;
		win_fab_header.isStroked = true;
		win_fab_header.strokeColor = 2061917;
		win_fab_header.lineWidth = 2;
		win_fab_header.setRounded(22);

		// win.fab.result-icon-surface
		const win_fab_result_icon_surface = this.add.image(195, 170, "icon_control_surface");
		win_fab_result_icon_surface.scaleX = 0.01;
		win_fab_result_icon_surface.scaleY = 0.01;
		win_fab_result_icon_surface.visible = false;

		// win.fab.result-medal
		const win_fab_result_medal = this.add.rectangle(195, 260, 56, 56);
		win_fab_result_medal.isFilled = true;
		win_fab_result_medal.fillColor = 2061917;
		win_fab_result_medal.setRounded(28);

		// win.fab.result-icon
		const win_fab_result_icon = this.add.image(195, 260, "icon_control_result_win");
		win_fab_result_icon.scaleX = 0.28;
		win_fab_result_icon.scaleY = 0.28;

		// win.fab.confetti-a
		const win_fab_confetti_a = this.add.rectangle(68, 278, 8, 18);
		win_fab_confetti_a.isFilled = true;
		win_fab_confetti_a.fillColor = 11095878;
		win_fab_confetti_a.setRounded(4);

		// win.fab.confetti-b
		const win_fab_confetti_b = this.add.rectangle(102, 340, 8, 14);
		win_fab_confetti_b.isFilled = true;
		win_fab_confetti_b.fillColor = 3563376;
		win_fab_confetti_b.setRounded(4);

		// win.fab.confetti-c
		const win_fab_confetti_c = this.add.rectangle(150, 270, 14, 8);
		win_fab_confetti_c.isFilled = true;
		win_fab_confetti_c.fillColor = 16772514;
		win_fab_confetti_c.setRounded(4);

		// win.fab.confetti-d
		const win_fab_confetti_d = this.add.rectangle(248, 272, 8, 16);
		win_fab_confetti_d.isFilled = true;
		win_fab_confetti_d.fillColor = 6137727;
		win_fab_confetti_d.setRounded(4);

		// win.fab.confetti-e
		const win_fab_confetti_e = this.add.rectangle(286, 356, 14, 8);
		win_fab_confetti_e.isFilled = true;
		win_fab_confetti_e.fillColor = 11095878;
		win_fab_confetti_e.setRounded(4);

		// win.fab.confetti-f
		const win_fab_confetti_f = this.add.rectangle(332, 258, 8, 14);
		win_fab_confetti_f.isFilled = true;
		win_fab_confetti_f.fillColor = 16772514;
		win_fab_confetti_f.setRounded(4);

		// win.fab.reward-ribbon
		const win_fab_reward_ribbon = this.add.rectangle(195, 425, 294, 110);
		win_fab_reward_ribbon.isFilled = true;
		win_fab_reward_ribbon.fillColor = 14479088;
		win_fab_reward_ribbon.isStroked = true;
		win_fab_reward_ribbon.strokeColor = 11257804;
		win_fab_reward_ribbon.lineWidth = 2;
		win_fab_reward_ribbon.setRounded(22);

		// win.fab.explainer
		const win_fab_explainer = this.add.text(195, 457, "", {});
		win_fab_explainer.setOrigin(0.5, 0.5);
		win_fab_explainer.text = "A new route is ready.";
		win_fab_explainer.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// win.fab.claim-control
		const win_fab_claim_control = this.add.rectangle(195, 526, 294, 60);
		win_fab_claim_control.isFilled = true;
		win_fab_claim_control.fillColor = 1339983;
		win_fab_claim_control.setRounded(20);

		// win.fab.claim-double-control
		const win_fab_claim_double_control = this.add.rectangle(195, 608, 294, 72);
		win_fab_claim_double_control.isFilled = true;
		win_fab_claim_double_control.fillColor = 14216932;
		win_fab_claim_double_control.isStroked = true;
		win_fab_claim_double_control.strokeColor = 2061917;
		win_fab_claim_double_control.lineWidth = 2;
		win_fab_claim_double_control.setRounded(20);

		// win.fab.claim-double-icon-surface
		const win_fab_claim_double_icon_surface = this.add.rectangle(74, 608, 40, 40);
		win_fab_claim_double_icon_surface.isFilled = true;
		win_fab_claim_double_icon_surface.fillColor = 2061917;
		win_fab_claim_double_icon_surface.setRounded(20);

		// win.fab.claim-double-icon
		const win_fab_claim_double_icon = this.add.image(74, 608, "icon_control_play");
		win_fab_claim_double_icon.scaleX = 0.26;
		win_fab_claim_double_icon.scaleY = 0.26;

		// win.fab.claim-surface
		const win_fab_claim_surface = this.add.image(195, 650, "button_surface_primary");
		win_fab_claim_surface.scaleX = 0.01;
		win_fab_claim_surface.scaleY = 0.01;
		win_fab_claim_surface.setOrigin(0.5, 1);
		win_fab_claim_surface.visible = false;

		// win.fab.claim-double-surface
		const win_fab_claim_double_surface = this.add.image(195, 738, "button_surface_secondary");
		win_fab_claim_double_surface.scaleX = 0.01;
		win_fab_claim_double_surface.scaleY = 0.01;
		win_fab_claim_double_surface.setOrigin(0.5, 1);
		win_fab_claim_double_surface.visible = false;

		// win.panel
		const win_panel = this.add.text(195, 330, "", {});
		win_panel.setOrigin(0.5, 0.5);
		win_panel.text = "Trail Complete";
		win_panel.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "22px" });

		// win.reward
		const win_reward = this.add.text(195, 399, "", {});
		win_reward.setOrigin(0.5, 0);
		win_reward.text = "5 Coins earned";
		win_reward.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// win.claim
		const win_claim = this.add.text(195, 540, "", {});
		win_claim.setOrigin(0.5, 1);
		win_claim.text = "Claim";
		win_claim.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// win.claim-double
		const win_claim_double = this.add.text(218, 619, "", {});
		win_claim_double.setOrigin(0.5, 1);
		win_claim_double.text = "Watch ad · Double Coins";
		win_claim_double.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// win.next
		const win_next = this.add.text(195, 692.08, "", {});
		win_next.setOrigin(0.5, 1);
		win_next.visible = false;
		win_next.text = "Next";
		win_next.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// win.home
		const win_home = this.add.text(195, 776.48, "", {});
		win_home.setOrigin(0.5, 1);
		win_home.visible = false;
		win_home.text = "Home";
		win_home.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// win_panel (components)
		const win_panelSemantic = new Semantic(win_panel);
		win_panelSemantic.fabSemanticId = "win.panel";
		win_panelSemantic.fabRole = "result-panel";
		win_panelSemantic.fabBinding = "presentation.static";
		win_panelSemantic.fabSlot = "modal-frame";
		win_panelSemantic.fabVariant = "default";

		// win_reward (components)
		const win_rewardSemantic = new Semantic(win_reward);
		win_rewardSemantic.fabSemanticId = "win.reward";
		win_rewardSemantic.fabRole = "level-label";
		win_rewardSemantic.fabBinding = "state.reward-amount";
		win_rewardSemantic.fabVariant = "default";

		// win_claim (components)
		const win_claimSemantic = new Semantic(win_claim);
		win_claimSemantic.fabSemanticId = "win.claim";
		win_claimSemantic.fabRole = "bottom-primary-action";
		win_claimSemantic.fabBinding = "flow.claim";
		win_claimSemantic.fabSlot = "button-surface";
		win_claimSemantic.fabVariant = "default";

		// win_claim_double (components)
		const win_claim_doubleSemantic = new Semantic(win_claim_double);
		win_claim_doubleSemantic.fabSemanticId = "win.claim-double";
		win_claim_doubleSemantic.fabRole = "bottom-secondary-action";
		win_claim_doubleSemantic.fabBinding = "flow.claim-double";
		win_claim_doubleSemantic.fabSlot = "button-surface";
		win_claim_doubleSemantic.fabVariant = "default";

		// win_next (components)
		const win_nextSemantic = new Semantic(win_next);
		win_nextSemantic.fabSemanticId = "win.next";
		win_nextSemantic.fabRole = "bottom-primary-action";
		win_nextSemantic.fabBinding = "flow.next";
		win_nextSemantic.fabSlot = "button-surface";
		win_nextSemantic.fabVariant = "default";

		// win_home (components)
		const win_homeSemantic = new Semantic(win_home);
		win_homeSemantic.fabSemanticId = "win.home";
		win_homeSemantic.fabRole = "bottom-secondary-action";
		win_homeSemantic.fabBinding = "flow.result-home";
		win_homeSemantic.fabSlot = "button-surface";
		win_homeSemantic.fabVariant = "default";

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
