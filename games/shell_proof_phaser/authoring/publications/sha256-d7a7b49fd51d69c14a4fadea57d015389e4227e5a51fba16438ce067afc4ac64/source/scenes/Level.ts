
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

		// level.fab.backdrop
		const level_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		level_fab_backdrop.isFilled = true;
		level_fab_backdrop.fillColor = 16250607;

		// level.fab.header-band
		const level_fab_header_band = this.add.rectangle(195, 52, 390, 104);
		level_fab_header_band.isFilled = true;
		level_fab_header_band.fillColor = 15199984;

		// level.fab.counter
		const level_fab_counter = this.add.rectangle(16, 28, 120, 48);
		level_fab_counter.setOrigin(0, 0);
		level_fab_counter.isFilled = true;
		level_fab_counter.fillColor = 1519682;
		level_fab_counter.setRounded(24);

		// level.fab.balance
		const level_fab_balance = this.add.text(92, 52, "", {});
		level_fab_balance.setOrigin(0.5, 0.5);
		level_fab_balance.text = "25 Coins";
		level_fab_balance.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// level.fab.gameplay-card
		const level_fab_gameplay_card = this.add.rectangle(195, 394, 350, 540);
		level_fab_gameplay_card.isFilled = true;
		level_fab_gameplay_card.fillColor = 14479088;
		level_fab_gameplay_card.isStroked = true;
		level_fab_gameplay_card.strokeColor = 11257804;
		level_fab_gameplay_card.lineWidth = 2;
		level_fab_gameplay_card.setRounded(28);

		// level.fab.sun
		const level_fab_sun = this.add.rectangle(304, 208, 50, 50);
		level_fab_sun.isFilled = true;
		level_fab_sun.fillColor = 16772514;
		level_fab_sun.setRounded(25);

		// level.fab.hill-far
		const level_fab_hill_far = this.add.rectangle(118, 566, 190, 86);
		level_fab_hill_far.isFilled = true;
		level_fab_hill_far.fillColor = 10211249;
		level_fab_hill_far.setRounded(43);

		// level.fab.hill-near
		const level_fab_hill_near = this.add.rectangle(284, 550, 168, 118);
		level_fab_hill_near.isFilled = true;
		level_fab_hill_near.fillColor = 6137727;
		level_fab_hill_near.setRounded(58);

		// level.fab.gameplay-label
		const level_fab_gameplay_label = this.add.text(48, 170, "", {});
		level_fab_gameplay_label.setOrigin(0, 0.5);
		level_fab_gameplay_label.text = "TRAIL CLEARING";
		level_fab_gameplay_label.setStyle({ "color": "#1f765d", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// level.fab.gameplay-title
		const level_fab_gameplay_title = this.add.text(48, 202, "", {});
		level_fab_gameplay_title.setOrigin(0, 0.5);
		level_fab_gameplay_title.text = "Find the next step";
		level_fab_gameplay_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "20px" });

		// level.fab.gameplay-copy
		const level_fab_gameplay_copy = this.add.text(48, 236, "", {});
		level_fab_gameplay_copy.setOrigin(0, 0.5);
		level_fab_gameplay_copy.text = "A calm path opens ahead.";
		level_fab_gameplay_copy.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// level.fab.path-a
		const level_fab_path_a = this.add.rectangle(130, 490, 110, 10);
		level_fab_path_a.isFilled = true;
		level_fab_path_a.fillColor = 16049335;
		level_fab_path_a.setRounded(5);

		// level.fab.path-b
		const level_fab_path_b = this.add.rectangle(185, 450, 10, 90);
		level_fab_path_b.isFilled = true;
		level_fab_path_b.fillColor = 16049335;
		level_fab_path_b.setRounded(5);

		// level.fab.path-c
		const level_fab_path_c = this.add.rectangle(240, 410, 120, 10);
		level_fab_path_c.isFilled = true;
		level_fab_path_c.fillColor = 16049335;
		level_fab_path_c.setRounded(5);

		// level.fab.marker-start
		const level_fab_marker_start = this.add.rectangle(75, 490, 54, 54);
		level_fab_marker_start.isFilled = true;
		level_fab_marker_start.fillColor = 7517582;
		level_fab_marker_start.setRounded(27);

		// level.fab.marker-start-icon
		const level_fab_marker_start_icon = this.add.image(75, 490, "icon_control_confirm");
		level_fab_marker_start_icon.scaleX = 0.3;
		level_fab_marker_start_icon.scaleY = 0.3;

		// level.fab.marker-current-halo
		const level_fab_marker_current_halo = this.add.rectangle(185, 450, 66, 66);
		level_fab_marker_current_halo.isFilled = true;
		level_fab_marker_current_halo.fillColor = 14216932;
		level_fab_marker_current_halo.setRounded(33);

		// level.fab.marker-current
		const level_fab_marker_current = this.add.image(185, 450, "progression_node_current");
		level_fab_marker_current.scaleX = 0.34;
		level_fab_marker_current.scaleY = 0.34;

		// level.fab.marker-goal
		const level_fab_marker_goal = this.add.rectangle(300, 410, 54, 54);
		level_fab_marker_goal.isFilled = true;
		level_fab_marker_goal.fillColor = 2061917;
		level_fab_marker_goal.setRounded(27);

		// level.fab.marker-goal-icon
		const level_fab_marker_goal_icon = this.add.image(300, 410, "icon_control_result_win");
		level_fab_marker_goal_icon.scaleX = 0.3;
		level_fab_marker_goal_icon.scaleY = 0.3;

		// level.fab.pause-control
		const level_fab_pause_control = this.add.rectangle(354, 52, 48, 48);
		level_fab_pause_control.isFilled = true;
		level_fab_pause_control.fillColor = 3563376;
		level_fab_pause_control.setRounded(16);

		// level.fab.pause-surface
		const level_fab_pause_surface = this.add.image(374.4, 52, "icon_control_surface");
		level_fab_pause_surface.scaleX = 0.01;
		level_fab_pause_surface.scaleY = 0.01;
		level_fab_pause_surface.setOrigin(1, 0);
		level_fab_pause_surface.visible = false;

		// level.fab.outcome-label
		const level_fab_outcome_label = this.add.text(195, 708, "", {});
		level_fab_outcome_label.setOrigin(0.5, 0.5);
		level_fab_outcome_label.text = "CHOOSE OUTCOME";
		level_fab_outcome_label.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// level.fab.test-win-control
		const level_fab_test_win_control = this.add.rectangle(96, 772, 160, 56);
		level_fab_test_win_control.isFilled = true;
		level_fab_test_win_control.fillColor = 1339983;
		level_fab_test_win_control.setRounded(18);

		// level.fab.test-lose-control
		const level_fab_test_lose_control = this.add.rectangle(294, 772, 160, 56);
		level_fab_test_lose_control.isFilled = true;
		level_fab_test_lose_control.fillColor = 11095878;
		level_fab_test_lose_control.isStroked = true;
		level_fab_test_lose_control.strokeColor = 11095878;
		level_fab_test_lose_control.lineWidth = 2;
		level_fab_test_lose_control.setRounded(18);

		// level.fab.test-win-surface
		const level_fab_test_win_surface = this.add.image(8, 804, "button_surface_test_win");
		level_fab_test_win_surface.scaleX = 0.01;
		level_fab_test_win_surface.scaleY = 0.01;
		level_fab_test_win_surface.setOrigin(0, 1);
		level_fab_test_win_surface.visible = false;

		// level.fab.test-lose-surface
		const level_fab_test_lose_surface = this.add.image(382, 804, "button_surface_test_lose");
		level_fab_test_lose_surface.scaleX = 0.01;
		level_fab_test_lose_surface.scaleY = 0.01;
		level_fab_test_lose_surface.setOrigin(1, 1);
		level_fab_test_lose_surface.visible = false;

		// level.currency
		const level_currency = this.add.image(24, 38, "counter_frame_primary_currency");
		level_currency.scaleX = 0.28;
		level_currency.scaleY = 0.28;
		level_currency.setOrigin(0, 0);

		// level.label
		const level_label = this.add.text(195, 52, "", {});
		level_label.setOrigin(0.5, 0);
		level_label.text = "Trail 2";
		level_label.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "22px" });

		// level.pause
		const level_pause = this.add.image(372, 34, "icon_control_pause");
		level_pause.scaleX = 0.36;
		level_pause.scaleY = 0.36;
		level_pause.setOrigin(1, 0);

		// level.gameplay-region
		const level_gameplay_region = this.add.container(195, 422);

		// level.test-win
		const level_test_win = this.add.text(36, 792, "", {});
		level_test_win.setOrigin(0, 1);
		level_test_win.text = "Win";
		level_test_win.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// level.test-lose
		const level_test_lose = this.add.text(354, 792, "", {});
		level_test_lose.setOrigin(1, 1);
		level_test_lose.text = "Lose";
		level_test_lose.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

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
