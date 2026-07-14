
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Menu extends Phaser.Scene {

	constructor() {
		super("Menu");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// menu.fab.backdrop
		const menu_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		menu_fab_backdrop.isFilled = true;
		menu_fab_backdrop.fillColor = 16250607;

		// menu.fab.header-band
		const menu_fab_header_band = this.add.rectangle(195, 1, 1, 1);
		menu_fab_header_band.isFilled = true;
		menu_fab_header_band.fillColor = 16250607;
		menu_fab_header_band.fillAlpha = 0;

		// menu.fab.counter
		const menu_fab_counter = this.add.rectangle(20, 34, 144, 56);
		menu_fab_counter.setOrigin(0, 0);
		menu_fab_counter.isFilled = true;
		menu_fab_counter.fillColor = 1519682;
		menu_fab_counter.isStroked = true;
		menu_fab_counter.strokeColor = 3563376;
		menu_fab_counter.strokeAlpha = 0.7;
		menu_fab_counter.lineWidth = 2;
		menu_fab_counter.setRounded(28);

		// menu.fab.balance
		const menu_fab_balance = this.add.text(108, 62, "", {});
		menu_fab_balance.setOrigin(0.5, 0.5);
		menu_fab_balance.text = "25 Coins";
		menu_fab_balance.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "17px" });

		// menu.fab.subtitle
		const menu_fab_subtitle = this.add.text(195, 155, "", {});
		menu_fab_subtitle.setOrigin(0.5, 0.5);
		menu_fab_subtitle.text = "A small adventure begins here.";
		menu_fab_subtitle.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow" });

		// menu.fab.hero-card
		const menu_fab_hero_card = this.add.rectangle(195, 300, 350, 210);
		menu_fab_hero_card.isFilled = true;
		menu_fab_hero_card.fillColor = 14150892;
		menu_fab_hero_card.isStroked = true;
		menu_fab_hero_card.strokeColor = 11257804;
		menu_fab_hero_card.lineWidth = 2;
		menu_fab_hero_card.setRounded(28);

		// menu.fab.hero-label
		const menu_fab_hero_label = this.add.text(48, 242, "", {});
		menu_fab_hero_label.setOrigin(0, 0.5);
		menu_fab_hero_label.text = "TRAIL 2";
		menu_fab_hero_label.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow" });

		// menu.fab.hero-title
		const menu_fab_hero_title = this.add.text(48, 278, "", {});
		menu_fab_hero_title.setOrigin(0, 0.5);
		menu_fab_hero_title.text = "Find the next step";
		menu_fab_hero_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// menu.fab.hero-copy
		const menu_fab_hero_copy = this.add.text(48, 320, "", {});
		menu_fab_hero_copy.setOrigin(0, 0.5);
		menu_fab_hero_copy.text = "The trail is ready.";
		menu_fab_hero_copy.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow" });

		// menu.fab.hero-sun
		const menu_fab_hero_sun = this.add.rectangle(318, 238, 48, 48);
		menu_fab_hero_sun.isFilled = true;
		menu_fab_hero_sun.fillColor = 16772514;
		menu_fab_hero_sun.setRounded(24);

		// menu.fab.hero-hill-far
		const menu_fab_hero_hill_far = this.add.rectangle(274, 358, 150, 54);
		menu_fab_hero_hill_far.isFilled = true;
		menu_fab_hero_hill_far.fillColor = 10211249;
		menu_fab_hero_hill_far.setRounded(27);

		// menu.fab.hero-hill-near
		const menu_fab_hero_hill_near = this.add.rectangle(310, 362, 86, 54);
		menu_fab_hero_hill_near.isFilled = true;
		menu_fab_hero_hill_near.fillColor = 6137727;
		menu_fab_hero_hill_near.setRounded(27);

		// menu.fab.hero-path
		const menu_fab_hero_path = this.add.rectangle(260, 357, 30, 56);
		menu_fab_hero_path.isFilled = true;
		menu_fab_hero_path.fillColor = 16049335;
		menu_fab_hero_path.setRounded(15);

		// menu.fab.hero-node-halo
		const menu_fab_hero_node_halo = this.add.rectangle(1, 1, 1, 1);
		menu_fab_hero_node_halo.isFilled = true;
		menu_fab_hero_node_halo.fillColor = 16250607;
		menu_fab_hero_node_halo.fillAlpha = 0;
		menu_fab_hero_node_halo.setRounded(38);

		// menu.fab.hero-node
		const menu_fab_hero_node = this.add.image(1, 1, "progression_node_current");
		menu_fab_hero_node.scaleX = 0.01;
		menu_fab_hero_node.scaleY = 0.01;
		menu_fab_hero_node.visible = false;

		// menu.fab.hero-flag-pole
		const menu_fab_hero_flag_pole = this.add.rectangle(309, 286, 6, 78);
		menu_fab_hero_flag_pole.isFilled = true;
		menu_fab_hero_flag_pole.fillColor = 2061917;
		menu_fab_hero_flag_pole.setRounded(3);

		// menu.fab.hero-flag
		const menu_fab_hero_flag = this.add.rectangle(326, 260, 40, 28);
		menu_fab_hero_flag.isFilled = true;
		menu_fab_hero_flag.fillColor = 1339983;
		menu_fab_hero_flag.setRounded(7);

		// menu.fab.progression-card
		const menu_fab_progression_card = this.add.rectangle(195, 560, 350, 220);
		menu_fab_progression_card.isFilled = true;
		menu_fab_progression_card.isStroked = true;
		menu_fab_progression_card.strokeColor = 11257804;
		menu_fab_progression_card.strokeAlpha = 0.8;
		menu_fab_progression_card.lineWidth = 2;
		menu_fab_progression_card.setRounded(28);

		// menu.fab.progress-path-left
		const menu_fab_progress_path_left = this.add.rectangle(148, 569, 94, 8);
		menu_fab_progress_path_left.isFilled = true;
		menu_fab_progress_path_left.fillColor = 1339983;
		menu_fab_progress_path_left.setRounded(4);

		// menu.fab.progress-path-right
		const menu_fab_progress_path_right = this.add.rectangle(242, 569, 94, 8);
		menu_fab_progress_path_right.isFilled = true;
		menu_fab_progress_path_right.fillColor = 14216932;
		menu_fab_progress_path_right.setRounded(4);

		// menu.fab.node-completed-surface
		const menu_fab_node_completed_surface = this.add.rectangle(101, 557, 64, 64);
		menu_fab_node_completed_surface.isFilled = true;
		menu_fab_node_completed_surface.fillColor = 7517582;
		menu_fab_node_completed_surface.setRounded(32);

		// menu.fab.node-completed-icon
		const menu_fab_node_completed_icon = this.add.image(101, 557, "icon_control_confirm");
		menu_fab_node_completed_icon.scaleX = 0.36;
		menu_fab_node_completed_icon.scaleY = 0.36;

		// menu.fab.node-current-halo
		const menu_fab_node_current_halo = this.add.rectangle(195, 591, 76, 76);
		menu_fab_node_current_halo.isFilled = true;
		menu_fab_node_current_halo.fillColor = 14216932;
		menu_fab_node_current_halo.setRounded(38);

		// menu.fab.node-current-label
		const menu_fab_node_current_label = this.add.text(195, 632, "", {});
		menu_fab_node_current_label.setOrigin(0.5, 0.5);
		menu_fab_node_current_label.text = "CURRENT · 2";
		menu_fab_node_current_label.setStyle({ "color": "#1f765d", "fontFamily": "kenney_future_narrow" });

		// menu.fab.node-locked-surface
		const menu_fab_node_locked_surface = this.add.rectangle(289, 557, 64, 64);
		menu_fab_node_locked_surface.isFilled = true;
		menu_fab_node_locked_surface.fillColor = 7836572;
		menu_fab_node_locked_surface.setRounded(32);

		// menu.fab.progress-copy
		const menu_fab_progress_copy = this.add.text(195, 654, "", {});
		menu_fab_progress_copy.setOrigin(0.5, 0.5);
		menu_fab_progress_copy.text = "TRAIL PROGRESS";
		menu_fab_progress_copy.setStyle({ "color": "#1f765d", "fontFamily": "kenney_future_narrow" });

		// menu.fab.dock
		const menu_fab_dock = this.add.rectangle(195, 844, 390, 144);
		menu_fab_dock.setOrigin(0.5, 1);
		menu_fab_dock.isFilled = true;

		// menu.fab.shop-shadow
		const menu_fab_shop_shadow = this.add.rectangle(63, 762, 104, 86);
		menu_fab_shop_shadow.isFilled = true;
		menu_fab_shop_shadow.fillColor = 1519682;
		menu_fab_shop_shadow.fillAlpha = 0.14;
		menu_fab_shop_shadow.setRounded(20);

		// menu.fab.play-shadow
		const menu_fab_play_shadow = this.add.rectangle(195, 758, 154, 94);
		menu_fab_play_shadow.isFilled = true;
		menu_fab_play_shadow.fillColor = 1519682;
		menu_fab_play_shadow.fillAlpha = 0.14;
		menu_fab_play_shadow.setRounded(24);

		// menu.fab.settings-shadow
		const menu_fab_settings_shadow = this.add.rectangle(327, 762, 104, 86);
		menu_fab_settings_shadow.isFilled = true;
		menu_fab_settings_shadow.fillColor = 1519682;
		menu_fab_settings_shadow.fillAlpha = 0.14;
		menu_fab_settings_shadow.setRounded(20);

		// menu.fab.shop-control
		const menu_fab_shop_control = this.add.rectangle(63, 758, 104, 86);
		menu_fab_shop_control.isFilled = true;
		menu_fab_shop_control.fillColor = 3563376;
		menu_fab_shop_control.isStroked = true;
		menu_fab_shop_control.strokeColor = 2061917;
		menu_fab_shop_control.strokeAlpha = 0.55;
		menu_fab_shop_control.lineWidth = 2;
		menu_fab_shop_control.setRounded(20);

		// menu.fab.play-control
		const menu_fab_play_control = this.add.rectangle(195, 754, 154, 94);
		menu_fab_play_control.isFilled = true;
		menu_fab_play_control.fillColor = 1339983;
		menu_fab_play_control.setRounded(24);

		// menu.fab.settings-control
		const menu_fab_settings_control = this.add.rectangle(327, 758, 104, 86);
		menu_fab_settings_control.isFilled = true;
		menu_fab_settings_control.fillColor = 3563376;
		menu_fab_settings_control.isStroked = true;
		menu_fab_settings_control.strokeColor = 2061917;
		menu_fab_settings_control.strokeAlpha = 0.55;
		menu_fab_settings_control.lineWidth = 2;
		menu_fab_settings_control.setRounded(20);

		// menu.fab.play-surface
		const menu_fab_play_surface = this.add.image(195, 798, "button_surface_primary");
		menu_fab_play_surface.scaleX = 0.01;
		menu_fab_play_surface.scaleY = 0.01;
		menu_fab_play_surface.setOrigin(0.5, 1);
		menu_fab_play_surface.visible = false;

		// menu.fab.shop-surface
		const menu_fab_shop_surface = this.add.image(100, 730, "icon_control_surface");
		menu_fab_shop_surface.scaleX = 0.01;
		menu_fab_shop_surface.scaleY = 0.01;
		menu_fab_shop_surface.setOrigin(1, 0);
		menu_fab_shop_surface.visible = false;

		// menu.fab.settings-surface
		const menu_fab_settings_surface = this.add.image(346, 730, "icon_control_surface");
		menu_fab_settings_surface.scaleX = 0.01;
		menu_fab_settings_surface.scaleY = 0.01;
		menu_fab_settings_surface.setOrigin(1, 0);
		menu_fab_settings_surface.visible = false;

		// menu.fab.play-icon
		const menu_fab_play_icon = this.add.image(195, 744, "icon_control_play");
		menu_fab_play_icon.scaleX = 0.4;
		menu_fab_play_icon.scaleY = 0.4;

		// menu.fab.shop-label
		const menu_fab_shop_label = this.add.text(63, 788, "", {});
		menu_fab_shop_label.setOrigin(0.5, 0.5);
		menu_fab_shop_label.text = "Shop";
		menu_fab_shop_label.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// menu.fab.settings-label
		const menu_fab_settings_label = this.add.text(327, 788, "", {});
		menu_fab_settings_label.setOrigin(0.5, 0.5);
		menu_fab_settings_label.text = "Settings";
		menu_fab_settings_label.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// menu.title
		const menu_title = this.add.text(195, 116, "", {});
		menu_title.setOrigin(0.5, 0);
		menu_title.text = "Trailbound";
		menu_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "24px" });

		// menu.hero
		const menu_hero = this.add.container(195, 312.28);

		// menu.currency
		const menu_currency = this.add.image(28, 44, "counter_frame_primary_currency");
		menu_currency.scaleX = 0.36;
		menu_currency.scaleY = 0.36;
		menu_currency.setOrigin(0, 0);

		// menu.nav
		const menu_nav = this.add.container(195, 827.12);

		// menu.shop
		const menu_shop = this.add.image(83, 738, "icon_control_shop");
		menu_shop.scaleX = 0.4;
		menu_shop.scaleY = 0.4;
		menu_shop.setOrigin(1, 0);

		// menu.play
		const menu_play = this.add.text(195, 786, "", {});
		menu_play.setOrigin(0.5, 1);
		menu_play.text = "Play";
		menu_play.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "18px" });

		// menu.settings
		const menu_settings = this.add.image(347, 738, "icon_control_settings");
		menu_settings.scaleX = 0.4;
		menu_settings.scaleY = 0.4;
		menu_settings.setOrigin(1, 0);

		// menu.progression-map
		const menu_progression_map = this.add.container(195, 548.6);

		// menu.node.completed
		const menu_node_completed = this.add.image(101.4, 557.04, "progression_node_completed");
		menu_node_completed.scaleX = 0.01;
		menu_node_completed.scaleY = 0.01;

		// menu.node.current
		const menu_node_current = this.add.image(195, 590.8, "progression_node_current");
		menu_node_current.scaleX = 0.45703125;
		menu_node_current.scaleY = 0.5275;

		// menu.node.locked
		const menu_node_locked = this.add.image(288.6, 557.04, "progression_node_locked");
		menu_node_locked.scaleX = 0.42;
		menu_node_locked.scaleY = 0.42;

		// menu_title (components)
		const menu_titleSemantic = new Semantic(menu_title);
		menu_titleSemantic.fabSemanticId = "menu.title";
		menu_titleSemantic.fabRole = "screen-title";
		menu_titleSemantic.fabBinding = "presentation.static";
		menu_titleSemantic.fabSlot = "title-logo";
		menu_titleSemantic.fabVariant = "default";

		// menu_hero (components)
		const menu_heroSemantic = new Semantic(menu_hero);
		menu_heroSemantic.fabSemanticId = "menu.hero";
		menu_heroSemantic.fabRole = "hero-art";
		menu_heroSemantic.fabBinding = "presentation.static";
		menu_heroSemantic.fabSlot = "hero-art";
		menu_heroSemantic.fabVariant = "default";

		// menu_currency (components)
		const menu_currencySemantic = new Semantic(menu_currency);
		menu_currencySemantic.fabSemanticId = "menu.currency";
		menu_currencySemantic.fabRole = "currency-counter";
		menu_currencySemantic.fabBinding = "state.primary-currency";
		menu_currencySemantic.fabSlot = "counter-frame";
		menu_currencySemantic.fabVariant = "default";

		// menu_nav (components)
		const menu_navSemantic = new Semantic(menu_nav);
		menu_navSemantic.fabSemanticId = "menu.nav";
		menu_navSemantic.fabRole = "bottom-nav";
		menu_navSemantic.fabBinding = "presentation.static";
		menu_navSemantic.fabVariant = "default";

		// menu_shop (components)
		const menu_shopSemantic = new Semantic(menu_shop);
		menu_shopSemantic.fabSemanticId = "menu.shop";
		menu_shopSemantic.fabRole = "top-icon-action";
		menu_shopSemantic.fabBinding = "flow.open-shop";
		menu_shopSemantic.fabSlot = "icon-control";
		menu_shopSemantic.fabVariant = "default";

		// menu_play (components)
		const menu_playSemantic = new Semantic(menu_play);
		menu_playSemantic.fabSemanticId = "menu.play";
		menu_playSemantic.fabRole = "bottom-primary-action";
		menu_playSemantic.fabBinding = "flow.start-current";
		menu_playSemantic.fabSlot = "button-surface";
		menu_playSemantic.fabVariant = "default";

		// menu_settings (components)
		const menu_settingsSemantic = new Semantic(menu_settings);
		menu_settingsSemantic.fabSemanticId = "menu.settings";
		menu_settingsSemantic.fabRole = "top-icon-action";
		menu_settingsSemantic.fabBinding = "flow.open-settings";
		menu_settingsSemantic.fabSlot = "icon-control";
		menu_settingsSemantic.fabVariant = "default";

		// menu_progression_map (components)
		const menu_progression_mapSemantic = new Semantic(menu_progression_map);
		menu_progression_mapSemantic.fabSemanticId = "menu.progression-map";
		menu_progression_mapSemantic.fabRole = "progression-map";
		menu_progression_mapSemantic.fabBinding = "state.progression";
		menu_progression_mapSemantic.fabVariant = "default";

		// menu_node_completed (components)
		const menu_node_completedSemantic = new Semantic(menu_node_completed);
		menu_node_completedSemantic.fabSemanticId = "menu.node.completed";
		menu_node_completedSemantic.fabRole = "progression-node";
		menu_node_completedSemantic.fabBinding = "state.progression";
		menu_node_completedSemantic.fabSlot = "progression-node";
		menu_node_completedSemantic.fabVariant = "default";

		// menu_node_current (components)
		const menu_node_currentSemantic = new Semantic(menu_node_current);
		menu_node_currentSemantic.fabSemanticId = "menu.node.current";
		menu_node_currentSemantic.fabRole = "progression-node";
		menu_node_currentSemantic.fabBinding = "flow.start-current";
		menu_node_currentSemantic.fabSlot = "progression-node";
		menu_node_currentSemantic.fabVariant = "default";

		// menu_node_locked (components)
		const menu_node_lockedSemantic = new Semantic(menu_node_locked);
		menu_node_lockedSemantic.fabSemanticId = "menu.node.locked";
		menu_node_lockedSemantic.fabRole = "progression-node";
		menu_node_lockedSemantic.fabBinding = "state.progression";
		menu_node_lockedSemantic.fabSlot = "progression-node";
		menu_node_lockedSemantic.fabVariant = "default";

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
