
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

		// menu.title
		const menu_title = this.add.text(195, 16.88, "", {});
		menu_title.setOrigin(0.5, 0);
		menu_title.text = "Game Title";
		menu_title.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// menu.hero
		const menu_hero = this.add.container(195, 312.28);

		// menu.currency
		const menu_currency = this.add.image(15.6, 21.1, "counter_frame_primary_currency");
		menu_currency.scaleX = 1.248;
		menu_currency.scaleY = 0.5486;
		menu_currency.setOrigin(0, 0);

		// menu.nav
		const menu_nav = this.add.container(195, 827.12);

		// menu.shop
		const menu_shop = this.add.image(312, 21.1, "icon_control_shop");
		menu_shop.scaleX = 0.546;
		menu_shop.scaleY = 0.5908;
		menu_shop.setOrigin(1, 0);

		// menu.play
		const menu_play = this.add.text(195, 810.24, "", {});
		menu_play.setOrigin(0.5, 1);
		menu_play.text = "Play";
		menu_play.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// menu.settings
		const menu_settings = this.add.image(374.4, 21.1, "icon_control_settings");
		menu_settings.scaleX = 0.546;
		menu_settings.scaleY = 0.5908;
		menu_settings.setOrigin(1, 0);

		// menu.progression-map
		const menu_progression_map = this.add.container(195, 548.6);

		// menu.node.completed
		const menu_node_completed = this.add.image(101.4, 557.04, "progression_node_completed");
		menu_node_completed.scaleX = 0.585;
		menu_node_completed.scaleY = 0.6752;

		// menu.node.current
		const menu_node_current = this.add.image(195, 590.8, "progression_node_current");
		menu_node_current.scaleX = 0.45703125;
		menu_node_current.scaleY = 0.5275;

		// menu.node.locked
		const menu_node_locked = this.add.image(288.6, 557.04, "progression_node_locked");
		menu_node_locked.scaleX = 0.585;
		menu_node_locked.scaleY = 0.6752;

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
