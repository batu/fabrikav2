
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

		// win.panel
		const win_panel = this.add.text(195, 422, "", {});
		win_panel.setOrigin(0.5, 0.5);
		win_panel.text = "You Win";
		win_panel.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// win.reward
		const win_reward = this.add.text(195, 21.1, "", {});
		win_reward.setOrigin(0.5, 0);
		win_reward.text = "Reward";
		win_reward.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// win.claim
		const win_claim = this.add.text(195, 692.08, "", {});
		win_claim.setOrigin(0.5, 1);
		win_claim.text = "Claim";
		win_claim.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// win.claim-double
		const win_claim_double = this.add.text(195, 776.48, "", {});
		win_claim_double.setOrigin(0.5, 1);
		win_claim_double.text = "Claim 2x";
		win_claim_double.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

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
