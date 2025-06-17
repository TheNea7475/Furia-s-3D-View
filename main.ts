import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView } from 'obsidian';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';




// Remember to rename these classes and interfaces!
// Constants
const VIEW_TYPE_3D_GRAPH = "3d-graph-view";


interface PluginSettings {
    forces: {
        gravity: number;
        repulsion: number;
        damping: number;
        centerAttraction: number;
        linkStrength: number;
    };
    maxVisibleDistance: number;
    labelScale: number;
    baseNodeScale: number
    bloomStrength: number;
    bloomRadius: number;
    bloomThreshold: number;
    linkScaleMultiplier: number;
    folderColors: { [folderPath: string]: string }; // folderPath -> color hex or 'inherited'
    defaultNodeColor: string; // Default color for nodes not in any folder
    maxParticles: number;
    particlesSpawnRate: number;
    particlesShuffleDelay: number;
}

const DEFAULT_SETTINGS: PluginSettings = {
    forces: {
        gravity: 0.02,
        repulsion: 0.8,
        damping: 0.90,
        centerAttraction: 0.001,
        linkStrength: 0.03
    },
    maxVisibleDistance: 15,
    labelScale: 0.05,
    baseNodeScale: 1,
    bloomStrength: 2,
    bloomRadius: 0.1,
    bloomThreshold: 0.9,
    linkScaleMultiplier: 0.1,
    folderColors: {},
    defaultNodeColor: '#ffffff',
    maxParticles: 500,
    particlesSpawnRate: 2000, //milliseconds
    particlesShuffleDelay: 10, //milliseconds
}


//Utility general functions

function getFolderHierarchy(folderPath: string): string[] {
    if (!folderPath || folderPath === '/') return [];
    const parts = folderPath.split('/').filter(part => part.length > 0);
    const hierarchy = [];
    for (let i = 0; i < parts.length; i++) {
        hierarchy.push(parts.slice(0, i + 1).join('/'));
    }
    return hierarchy;
}

function getNodeColorForFile(filePath: string, settings: PluginSettings): string {
    // Get the folder path from file path
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    
    if (!folderPath) {
        // File is in root, use default color
        return settings.defaultNodeColor;
    }
    
    // Get folder hierarchy from deepest to shallowest
    const hierarchy = getFolderHierarchy(folderPath).reverse();
    
    // Find the first folder in hierarchy that has a non-inherited color
    for (const folder of hierarchy) {
        const color = settings.folderColors[folder];
        if (color && color !== 'inherited') {
            return color;
        }
    }
    
    // If no folder has a specific color, use default
    return settings.defaultNodeColor;
}

function hexToThreeColor(hex: string): number {
    // Remove # if present
    hex = hex.replace('#', '');
    return parseInt(hex, 16);
}



export default class MyPlugin extends Plugin {
	settings: PluginSettings;
	graphView: GraphView | null = null; // Add reference to GraphView

	async onload() {

		//Await settings to be loaded
		await this.loadSettings();

		//Register the graph view
		const plugin = this; // Capture reference
		this.registerView(
			VIEW_TYPE_3D_GRAPH,
			(leaf) => {
				const view = new GraphView(leaf);
				(view as any).plugin = plugin;
				plugin.graphView = view;
				return view;
			}
		);

		const ribbonIconEl = this.addRibbonIcon("globe", "Open 3D Graph", async () => {
			new Notice("Opening the graph!");
			await this.activateView();
		});


        //Might use those features later

		// Perform additional things with the ribbon
		//ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		//const statusBarItemEl = this.addStatusBarItem();
		//statusBarItemEl.setText('Status Bar Text');


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingsTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	// Update parameters from settings
	updateSettingsParameters() {

        //Check graph existance and update its properties if it exists
		if (this.graphView && this.graphView.gravityGraph) {

            // Update forces in the GraphView's GravityGraph
			this.graphView.gravityGraph.forces = {
				gravity: this.settings.forces.gravity,
				repulsion: this.settings.forces.repulsion,
				damping: this.settings.forces.damping,
				centerAttraction: this.settings.forces.centerAttraction,
				linkStrength: this.settings.forces.linkStrength
			};


            // NEW: Update node colors
            this.graphView.gravityGraph.updateNodeColors(this.settings);

		    // Update labels max distance in the GraphView's GravityGraph if it exists
			this.graphView.gravityGraph.maxVisibleDistance = this.settings.maxVisibleDistance;

            // Update nodes and labels dimensions and trigger the rescaling of nodes
            this.graphView.gravityGraph.baseNodeScale = this.settings.baseNodeScale;
            this.graphView.gravityGraph.linkScaleMultiplier = this.settings.linkScaleMultiplier;
            this.graphView.gravityGraph.labelScale = this.settings.labelScale;

            //Update particles settings
            this.graphView.gravityGraph.setMaxParticles(this.settings.maxParticles)
            this.graphView.gravityGraph.setParticleSpawnRate(this.settings.particlesSpawnRate)
            this.graphView.gravityGraph.setParticlesShuffleDelay(this.settings.particlesShuffleDelay)

            //Update bloom settings, if composer ready
            if (this.graphView.bloomPass) {
            this.graphView.bloomPass.strength = this.settings.bloomStrength;
            this.graphView.bloomPass.radius = this.settings.bloomRadius;
            this.graphView.bloomPass.threshold = this.settings.bloomThreshold;
            }
        }
    }


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

    async activateView() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_GRAPH);
        if (leaves.length === 0) {
            // Open in center area as new tab
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_3D_GRAPH,
                active: true,
            });
        } else {
            this.app.workspace.revealLeaf(leaves[0]);
        }
    }
}



// Settings
class SettingsTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const {containerEl} = this;
		containerEl.empty();

		// Forces settings header
		new Setting(containerEl).setName('Physics forces').setHeading();

		// Gravity setting
		new Setting(containerEl)
			.setName('Gravity')
			.setDesc('Controls downward force applied to nodes. Actually useless to change at the moment')
			.addSlider(slider => slider
				.setLimits(0.01, 0.1, 0.01)
				.setValue(this.plugin.settings.forces?.gravity ?? 0.02)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							gravity: 0.02,
							repulsion: 0.8,
							damping: 0.90,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.gravity = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Repulsion setting
		new Setting(containerEl)
			.setName('Repulsion')
			.setDesc('Controls how strongly nodes repel each other')
			.addSlider(slider => slider
				.setLimits(0.01, 2, 0.01)
				.setValue(this.plugin.settings.forces?.repulsion ?? 0.8)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							gravity: 0.02,
							repulsion: 0.8,
							damping: 0.90,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.repulsion = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Damping setting
		new Setting(containerEl)
			.setName('Damping')
			.setDesc('Controls velocity decay (Higer = more movement)')
			.addSlider(slider => slider
				.setLimits(0.1, 1, 0.01)
				.setValue(this.plugin.settings.forces?.damping ?? 0.90)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							gravity: 0.02,
							repulsion: 0.8,
							damping: 0.90,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.damping = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Center Attraction setting
		new Setting(containerEl)
			.setName('Center attraction')
			.setDesc('Controls how strongly nodes are pulled to center')
			.addSlider(slider => slider
				.setLimits(1, 100, 1)
				.setValue(this.plugin.settings.forces?.centerAttraction*10000)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							gravity: 0.02,
							repulsion: 0.8,
							damping: 0.90,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.centerAttraction = value/10000;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Link Strength setting
		new Setting(containerEl)
			.setName('Link strength')
			.setDesc('Controls how strongly connected nodes attract each other')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.forces?.linkStrength*100)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							gravity: 0.02,
							repulsion: 0.8,
							damping: 0.90,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.linkStrength = value/100;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Reset to defaults button
		new Setting(containerEl)
			.setName('Reset Forces')
			.setDesc('Reset all force values to their defaults')
			.addButton(button => button
				.setButtonText('Reset to Defaults')
				.onClick(async () => {
					this.plugin.settings.forces = {
						gravity: 0.02,
						repulsion: 0.8,
						damping: 0.90,
						centerAttraction: 0.001,
						linkStrength: 0.03
					};
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
					this.display(); // Refresh the UI
				}));


    	// View settings header
        new Setting(containerEl).setName('View').setHeading();

        // View settings
		new Setting(containerEl)
			.setName('Label text distance')
			.setDesc('Controls how far are nodes name rendered with a label')
			.addSlider(slider => slider
				.setLimits(1, 50, 1)
				.setValue(this.plugin.settings.maxVisibleDistance ?? 8)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.maxVisibleDistance) {
						this.plugin.settings.maxVisibleDistance = 8
					}
					this.plugin.settings.maxVisibleDistance = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

        // Label scaling
		new Setting(containerEl)
			.setName('Label dimension')
			.setDesc('Controls how big are labels above nodes')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.labelScale*10)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.labelScale) {
						this.plugin.settings.labelScale = 0.5
					}
					this.plugin.settings.labelScale = value/10;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

            // base node dimension
            new Setting(containerEl)
			.setName('Scale node')
			.setDesc("Make nodes appear bigger or smaller, it won't affect physics")
			.addSlider(slider => slider
				.setLimits(0.1, 5, 0.1)
				.setValue(this.plugin.settings.baseNodeScale ?? 1)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.baseNodeScale) {
						this.plugin.settings.baseNodeScale = 1
					}
					this.plugin.settings.baseNodeScale = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

            // linkScaleMultiplier
            new Setting(containerEl)
			.setName('Link count scale multiplier')
			.setDesc("How much a node grows for each link it has")
			.addSlider(slider => slider
				.setLimits(1, 200, 1)
				.setValue(this.plugin.settings.linkScaleMultiplier*100)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.linkScaleMultiplier) {
						this.plugin.settings.linkScaleMultiplier = 0.1
					}
					this.plugin.settings.linkScaleMultiplier = value/100;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

            // Particles
            new Setting(containerEl)
			.setName('Max particles number')
			.setDesc("How many particles are allowed to exist in a frame")
			.addSlider(slider => slider
				.setLimits(100, 1000, 1)
				.setValue(this.plugin.settings.maxParticles)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.maxParticles) {
						this.plugin.settings.maxParticles = 500
					}
					this.plugin.settings.maxParticles = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

            new Setting(containerEl)
			.setName('Particles spawnrate')
			.setDesc("Delay between particles spawning attempt, in milliseconds")
			.addSlider(slider => slider
				.setLimits(100, 5000, 1)
				.setValue(this.plugin.settings.particlesSpawnRate)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.particlesSpawnRate) {
						this.plugin.settings.particlesSpawnRate = 500
					}
					this.plugin.settings.particlesSpawnRate = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

            new Setting(containerEl)
			.setName('Particles shuffle delay')
			.setDesc("Delay between each particle spawn, in milliseconds")
			.addSlider(slider => slider
				.setLimits(0, 200, 10)
				.setValue(this.plugin.settings.particlesShuffleDelay)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.particlesShuffleDelay) {
						this.plugin.settings.particlesShuffleDelay = 10
					}
					this.plugin.settings.particlesShuffleDelay = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

            // Bloom settings header
            new Setting(containerEl).setName('Bloom').setHeading();

            // Bloom strenght
            new Setting(containerEl)
            .setName('Bloom strength')
            .setDesc('Controls the intensity of the bloom effect')
            .addSlider(slider => slider
                .setLimits(0, 3, 0.1)
                .setValue(this.plugin.settings.bloomStrength ?? 0.5)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (!this.plugin.settings.bloomStrength) {
                        this.plugin.settings.bloomStrength = 0.5;
                    }
                    this.plugin.settings.bloomStrength = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateSettingsParameters();
                }));

            // Bloom radius
            new Setting(containerEl)
            .setName('Bloom radius')
            .setDesc('Controls how far the bloom effect spreads')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.05)
                .setValue(this.plugin.settings.bloomRadius ?? 0.1)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (!this.plugin.settings.bloomRadius) {
                        this.plugin.settings.bloomRadius = 0.1;
                    }
                    this.plugin.settings.bloomRadius = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateSettingsParameters();
                }));

            // Bloom threshold
            new Setting(containerEl)
            .setName('Bloom threshold')
            .setDesc('Controls which brightness levels trigger the bloom effect')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.05)
                .setValue(this.plugin.settings.bloomThreshold ?? 0.3)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (!this.plugin.settings.bloomThreshold) {
                        this.plugin.settings.bloomThreshold = 0.3;
                    }
                    this.plugin.settings.bloomThreshold = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateSettingsParameters();
                }));


                // Heading
                new Setting(containerEl)
                    .setName('Folder Colors')
                    .setHeading()
                    .setDesc('Assign colors to folders. Notes inherit colors from their folder hierarchy. Configure individual folder colors.')

                new Setting(containerEl)
                    .setName('Default node color')
                    .setDesc('Color for nodes not in any folder or when no folder color is set')
                    .addColorPicker(colorPicker => colorPicker
                        .setValue(this.plugin.settings.defaultNodeColor)
                        .onChange(async (value) => {
                            this.plugin.settings.defaultNodeColor = value;
                            await this.plugin.saveSettings();
                            this.plugin.updateSettingsParameters();
                        }));
                        
                // Get all folders and create color settings for each
                const folders = await this.getAllFolders();

                // Sort folders alphabetically for better organization
                const sortedFolders = folders.sort((a, b) => a.localeCompare(b));

                for (const folderPath of sortedFolders) {
                    const currentColor = this.plugin.settings.folderColors[folderPath] || 'inherited';
                    
                    const setting = new Setting(containerEl)
                        .setName(`📁 ${folderPath}`)
                        .addDropdown(dropdown => dropdown
                            .addOption('inherited', 'Inherited (use default)')
                            .addOption('custom', 'Custom Color')
                            .setValue(currentColor === 'inherited' ? 'inherited' : 'custom')
                            .onChange(async (value) => {
                                if (value === 'inherited') {
                                    this.plugin.settings.folderColors[folderPath] = 'inherited';
                                    await this.plugin.saveSettings();
                                    this.plugin.updateSettingsParameters();
                                    this.display(); // Refresh to hide color picker
                                } else {
                                    // Set default custom color if none exists
                                    if (!this.plugin.settings.folderColors[folderPath] ||
                                        this.plugin.settings.folderColors[folderPath] === 'inherited') {
                                        this.plugin.settings.folderColors[folderPath] = this.plugin.settings.defaultNodeColor;
                                    }
                                    await this.plugin.saveSettings();
                                    this.plugin.updateSettingsParameters();
                                    this.display(); // Refresh to show color picker
                                }
                            }));

                    // Add color picker conditionally
                    if (currentColor !== 'inherited') {
                        setting.addColorPicker(colorPicker => colorPicker
                            .setValue(currentColor)
                            .onChange(async (value) => {
                                this.plugin.settings.folderColors[folderPath] = value;
                                await this.plugin.saveSettings();
                                this.plugin.updateSettingsParameters();
                            }));
                    }
                }

                // Actions Section
                new Setting(containerEl)
                    .setName('Actions')
                    .setHeading();

                // Reset folder colors button
                new Setting(containerEl)
                    .setName('Reset all folder colors')
                    .setDesc('Reset all folder colors to inherited and restore default node color to white')
                    .addButton(button => button
                        .setButtonText('Reset All Colors')
                        .setClass('mod-warning')
                        .onClick(async () => {
                            this.plugin.settings.folderColors = {};
                            this.plugin.settings.defaultNodeColor = '#ffffff';
                            await this.plugin.saveSettings();
                            this.plugin.updateSettingsParameters();
                            this.display(); // Refresh the UI
                        }));     





	}

    // Other Settings class methods
    private async getAllFolders(): Promise<string[]> {
        const folders = new Set<string>();
        const files = this.app.vault.getMarkdownFiles();
        
        for (const file of files) {
            const folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
            if (folderPath) {
                // Add all parent folders
                const hierarchy = getFolderHierarchy(folderPath);
                hierarchy.forEach(folder => folders.add(folder));
            }
        }
        
        return Array.from(folders).sort();
    }
}


class GraphView extends ItemView {
	static readonly VIEW_TYPE = VIEW_TYPE_3D_GRAPH;
    plugin: MyPlugin;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    bloomPass: UnrealBloomPass;
	controls: OrbitControls;
	animationFrameId: number;
	gravityGraph: GravityGraph;
	focusing: boolean = false;
	focusedNode: THREE.Object3D;
	activeLeafChangeHandler: () => void;
    resizeObserver: ResizeObserver;
    wheelAnimationId: number | null = null;
    currentWheelVelocity: number = 0;
    wheelDamping: number = 0.90;
    nodeAdditionTimer: number | null = null;
    allFiles: any[] = [];
    allLinks: Array<[string, string]> = [];
    currentNodeIndex: number = 0;
    currentLinkIndex: number = 0;
    nodeAddDelay: number = 5;
    linkAddDelay: number = 5;
    labelContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return GraphView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "3D Graph";
	}

    getIcon(): string {
        return "globe";
    }

	async onOpen() {
		//Creating container for graph
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.style.display = "flex";
		container.style.justifyContent = "center";
		container.style.alignItems = "center";
		container.style.overflow = "hidden";
        container.style.position = "relative";

		// Create canvas
		const canvas = document.createElement("canvas");
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.style.display = "block";
		canvas.style.margin = "0";
		container.appendChild(canvas);

        const labelContainer = document.createElement('div');
        labelContainer.style.position = 'absolute';
        labelContainer.style.top = '0';
        labelContainer.style.left = '0';
        labelContainer.style.width = '100%';
        labelContainer.style.height = '100%';
        labelContainer.style.pointerEvents = 'none';
        labelContainer.style.zIndex = '1000';
        container.appendChild(labelContainer);
        this.labelContainer = labelContainer;        

		// Retrieving vault notes and their links
		const metadataCache = this.app.metadataCache;
		const vault = this.app.vault;
		const files = vault.getMarkdownFiles();
		const links: Array<[string, string]> = [];

		// Collect all links
		for (const file of files) {
			const path = file.path;
			const basename = file.basename;
			// Get links from frontmatter and wikilinks
			const resolvedLinks = metadataCache.resolvedLinks[path];
			if (resolvedLinks) {
				for (const target in resolvedLinks) {
					const targetFile = this.app.metadataCache.getFirstLinkpathDest(target, path);
					if (targetFile) {
						links.push([basename, targetFile.basename]);
					}
				}
			}
		}


        // Store files and links for gradual addition
        this.allFiles = files;
        this.allLinks = links;



		// Simulating then rendering - Delayed so layout has time to stabilize
		setTimeout(() => {
			let width = container.offsetWidth || 600;
			let height = container.offsetHeight || 400;
			
			this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
			this.renderer.setSize(width, height);
			this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1;
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;


			this.scene = new THREE.Scene();
			this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
			this.camera.position.z = 15; // Move camera back to see the whole graph

            // Ambient light
			const ambientLight = new THREE.AmbientLight(0xffffff, 2); // Strong white light
			this.scene.add(ambientLight);


            // Composer with multiple pass
            const renderScene = new RenderPass(this.scene, this.camera);
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.plugin.settings.bloomStrength, // strength
                this.plugin.settings.bloomRadius, // radius
                this.plugin.settings.bloomThreshold // threshold
            );
            this.bloomPass.resolution = new THREE.Vector2(256, 256);

            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(renderScene);
            this.composer.addPass(this.bloomPass);

			// Controls section
			const stopAutoRotate = () => {
				if (this.focusing) {
					this.controls.autoRotate = false;
					this.focusing = false;
				}
			};
			this.renderer.domElement.addEventListener('pointerdown', stopAutoRotate);
			this.controls = new OrbitControls(this.camera, this.renderer.domElement);
			this.controls.enableDamping = true;
			this.controls.dampingFactor = 0.1;
			this.controls.enableZoom = false;

			this.controls.mouseButtons = {
				LEFT: THREE.MOUSE.PAN,
				MIDDLE: null,
				RIGHT: THREE.MOUSE.ROTATE,
			};

			// prevent OrbitControls from intercepting wheel events
			this.controls.listenToKeyEvents = () => {}; // Hack to avoid some internal bindings

			// Initialize gravity graph system
			this.gravityGraph = new GravityGraph(this.scene, this.labelContainer);
			
            //Apply stored settings
            this.plugin.updateSettingsParameters();

            /*
            // Applying settings
            if (this.plugin && this.plugin.settings && this.plugin.settings.forces) {
                this.gravityGraph.forces = {
                    gravity: this.plugin.settings.forces.gravity,
                    repulsion: this.plugin.settings.forces.repulsion,
                    damping: this.plugin.settings.forces.damping,
                    centerAttraction: this.plugin.settings.forces.centerAttraction,
                    linkStrength: this.plugin.settings.forces.linkStrength
                };
            }
            // Apply initial labels max distance setting
            if (this.plugin?.settings?.maxVisibleDistance !== undefined) {
                this.gravityGraph.maxVisibleDistance = this.plugin.settings.maxVisibleDistance;
            }
            */

			// Listen for active leaf changes, used for auto node focusing
			this.activeLeafChangeHandler = () => {
				const activeNoteName = this.getCurrentActiveNote();
				if (activeNoteName) {
					this.focusOnNodeByName(activeNoteName);
				}
			};
			this.app.workspace.on('active-leaf-change', this.activeLeafChangeHandler);

            // Start adding nodes gradually after a short delay.
            
            setTimeout(() => {
                this.startNodeAddition();
            }, 500);
            

			// Initialize positions and start physics simulation
			this.gravityGraph.initializePositions();
			this.gravityGraph.start(this.camera);
			this.gravityGraph.setParticleSpawnRate(this.plugin.settings.particlesSpawnRate);
			this.gravityGraph.setMaxParticles(this.plugin.settings.maxParticles);
            this.gravityGraph.setParticlesShuffleDelay(this.plugin.settings.particlesShuffleDelay)

			//Adding a raycaster for mouse clicking
			const raycaster = new THREE.Raycaster();
			const mouse = new THREE.Vector2();
			this.renderer.domElement.addEventListener('click', (event) => {
				// Convert mouse coordinates to normalized device coordinates
				const rect = this.renderer.domElement.getBoundingClientRect();
				mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
				mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

				raycaster.setFromCamera(mouse, this.camera);

				// Get clickable nodes from gravity graph
				const clickableNodes = Array.from(this.gravityGraph.nodes.values());

				const intersects = raycaster.intersectObjects(clickableNodes);
				if (intersects.length > 0) {
					const targetNode = intersects[0].object;
					this.focusOnNode(targetNode);
				}
			});


			// Main animation loop
			let lastTime = performance.now();
            const animate = () => {
                if (this.focusing && this.focusedNode) {
                    this.controls.target.copy(this.focusedNode.position);
                }
                
                this.controls.update(); // Remove duplicate call
                
                const currentTime = performance.now();
                const deltaTime = (currentTime - lastTime) / 1000;
                lastTime = currentTime;
                
                this.gravityGraph.updateParticles(deltaTime);
                this.composer.render(); // Single render call
                
                this.animationFrameId = requestAnimationFrame(animate);
            };
			animate();


			// Event listeners

            // Listener for zoom-to-move logic. instead of zooming move in 3d
            this.renderer.domElement.addEventListener('wheel', this.handleWheelMovement);

            
            // Use ResizeObserver to detect container size changes (panel collapse/expand)
            this.resizeObserver = new ResizeObserver(() => {
                    this.handleResize();
                    console.log("ResizeObserver triggered");
            });

            this.resizeObserver.observe(container);
            

			//End calls


		}, 100); //scene rendering delay
	}

    // Graph used methods

    startNodeAddition = () => {
        const addNextNode = () => {
            if (this.currentNodeIndex < this.allFiles.length) {
                const file = this.allFiles[this.currentNodeIndex];
                this.gravityGraph.addNode(file.basename, file.path);
                
                // Get the newly added node and give it a random position
                const newNode = this.gravityGraph.nodes.get(file.basename);
                if (newNode) {
                    // Random position in a sphere around origin
                    const spread = 8; // Same as initializePositions spread
                    const x = (Math.random() - 0.5) * spread;
                    const z = (Math.random() - 0.5) * spread;
                    const y = (Math.random() - 0.5) * spread * 0.3;
                    
                    newNode.position.set(x, y, z);
                    
                    // Give it some initial velocity for more dynamic appearance
                    if ((newNode as any).velocity) {
                        (newNode as any).velocity.set(
                            (Math.random() - 0.5) * 0.1,
                            (Math.random() - 0.5) * 0.1,
                            (Math.random() - 0.5) * 0.1
                        );
                    }
                }
                
                this.currentNodeIndex++;
                this.nodeAdditionTimer = setTimeout(addNextNode, this.nodeAddDelay) as unknown as number;
            } else {
                // All nodes added, start adding links
                setTimeout(() => {
                    this.startLinkAddition();
                }, 200);
            }
        };
        addNextNode();
    };

    startLinkAddition = () => {
        const addNextLink = () => {
            if (this.currentLinkIndex < this.allLinks.length) {
                const [from, to] = this.allLinks[this.currentLinkIndex];
                this.gravityGraph.addLink(from, to);
                this.currentLinkIndex++;
                
                this.nodeAdditionTimer = setTimeout(addNextLink, this.linkAddDelay) as unknown as number;
            }
        };
        addNextLink();
    };

    handleWheelMovement = (event: WheelEvent) => {
        event.preventDefault();

        const speed = 0.35;
        const delta = (event.deltaY > 0 ? -1 : 1) * speed;
        
        // Add to current velocity instead of replacing it
        this.currentWheelVelocity += delta;

        // Start smooth movement if not already running
        if (!this.wheelAnimationId) {
            const smoothMove = () => {
                if (Math.abs(this.currentWheelVelocity) > 0.1) {
                    const direction = new THREE.Vector3();
                    this.camera.getWorldDirection(direction);

                    this.camera.position.addScaledVector(direction, this.currentWheelVelocity);
                    this.controls.target.addScaledVector(direction, this.currentWheelVelocity);

                    // Apply damping
                    this.currentWheelVelocity *= this.wheelDamping;

                    this.wheelAnimationId = requestAnimationFrame(smoothMove);
                } else {
                    this.wheelAnimationId = null;
                    this.currentWheelVelocity = 0;
                }
            };
            smoothMove();
        }
    };

	handleResize = () => {
        setTimeout(() => {
        if (!this.renderer || !this.camera || !this.controls) return;
        const container = this.containerEl.children[1] as HTMLElement;
        const width = container.offsetWidth || 600;
        const height = container.offsetHeight || 400;
        this.renderer.setSize(container.offsetWidth, container.offsetHeight);
        this.camera.aspect = width / height;
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.camera.updateProjectionMatrix();
        this.composer.setPixelRatio(window.devicePixelRatio);
        this.composer.setSize(container.offsetWidth,container.offsetHeight);
        }, 10);

	};

    focusOnNode(targetNode: THREE.Object3D): void {
        new Notice(targetNode.userData.noteTitle);

        // Disable standard controls
        this.controls.enabled = false;
        this.controls.autoRotate = false;
        
        const distance = 5;
        const rotationSpeed = 0.002;
        let angle = 0;
        
        // Animation setup
        let animationPhase = 'flying'; // 'flying' or 'rotating'
        let t = 0;
        const flyDuration = 100;
        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        
        // Calculate target position for flying animation
        const currentTargetPos = targetNode.position.clone();
        const desiredDirection = startPos.clone().sub(currentTargetPos).normalize();
        const desiredCameraPos = currentTargetPos.clone().add(desiredDirection.clone().multiplyScalar(distance));
        
        // Calculate initial angle for rotation phase
        angle = Math.atan2(desiredDirection.z, desiredDirection.x);
        
        this.focusedNode = targetNode;
        this.focusing = true;
        
        const animate = () => {
            if (!this.focusing || this.focusedNode !== targetNode) {
                // Re-enable controls when stopping
                this.controls.enabled = true;
                this.controls.update();
                return;
            }
            
            const nodePos = targetNode.position.clone();
            
            if (animationPhase === 'flying') {
                // Flying animation phase
                t++;
                const alpha = t / flyDuration;
                
                // Recalculate target position in case node moved
                const currentDesiredPos = nodePos.clone().add(desiredDirection.clone().multiplyScalar(distance));
                
                this.camera.position.lerpVectors(startPos, currentDesiredPos, alpha);
                this.controls.target.lerpVectors(startTarget, nodePos, alpha);
                this.controls.update();
                
                if (t >= flyDuration) {
                    animationPhase = 'rotating';
                }
            } else {
                // Rotation phase
                const x = nodePos.x + Math.cos(angle) * distance;
                const z = nodePos.z + Math.sin(angle) * distance;
                const y = nodePos.y;
                
                this.camera.position.set(x, y, z);
                this.camera.lookAt(nodePos);
                
                angle += rotationSpeed;
            }
            
            //this.renderer.render(this.scene, this.camera);
            this.composer.render()
            requestAnimationFrame(animate);
        };
        
        animate();
    }

	getCurrentActiveNote(): string | null {
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf?.view.getViewType() === 'markdown') {
			const markdownView = activeLeaf.view as any;
			return markdownView.file?.basename || null;
		}
		return null;
	}

	focusOnNodeByName(noteName: string): void {
		const targetNode = Array.from(this.gravityGraph.nodes.values())
			.find(node => node.userData.noteTitle === noteName);
		
		if (targetNode) {
			this.focusOnNode(targetNode);
		}
	}

	async onClose() {

        if (this.labelContainer) {
            this.labelContainer.innerHTML = '';
        }

        if (this.gravityGraph) {
        this.gravityGraph.labels.clear();
        this.gravityGraph.stop();
        }
        
        if (this.wheelAnimationId) {
            cancelAnimationFrame(this.wheelAnimationId);
        }
        
        cancelAnimationFrame(this.animationFrameId);
        
        // Dispose Three.js resources
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object instanceof THREE.Mesh) {
                    object.geometry?.dispose();
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => mat.dispose());
                    } else {
                        object.material?.dispose();
                    }
                }
            });
        }
        
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        if (this.composer) {
            this.composer.dispose();
        }
		

        // Remove
        if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        };

        // CLean resize listeners
		window.removeEventListener("resize", this.handleResize);

		// Remove workspace listener
		if (this.activeLeafChangeHandler) {
			this.app.workspace.off('active-leaf-change', this.activeLeafChangeHandler);
        };

        // Remove wheel animation listener
        this.renderer.domElement.removeEventListener('wheel', this.handleWheelMovement);

        // Clean note addition timer
        if (this.nodeAdditionTimer) {
            clearTimeout(this.nodeAdditionTimer);
        }

        //DOM cleanup
		this.contentEl.empty();

	}
}

// Updated GravityGraph class that handles node creation internally
class GravityGraph {
    scene: THREE.Scene;
    nodes: Map<string, THREE.Object3D>;
    labels: Map<string, HTMLElement>;
    labelContainer: HTMLElement;
    links: Array<{from: THREE.Object3D, to: THREE.Object3D, line: THREE.Line}>;
    forces: {
        gravity: number;
        repulsion: number;
        damping: number;
        centerAttraction: number;
        linkStrength: number;
    };
    isRunning: boolean;
    animationId: number | null;
    particleSystem: LinkParticleSystem;
    velocityTreshold: number = 0.001; //0 to deactivate
    maxVisibleDistance: number = 8;
    labelScale: number = 0.05;
    baseNodeScale: number = 1;
    linkScaleMultiplier: number = 0.1;
    nodeFilePaths: Map<string, string>;
    currentSettings: PluginSettings | null;

    // Color pulsing properties
    colorPulseData: Map<string, {
        phase: number;
        speed: number;
        baseColor: THREE.Color;
        pulseColor: THREE.Color;
        emissiveStrenghtMultiplier: number;
    }>;

    constructor(scene: THREE.Scene, labelContainer: HTMLElement) {
        this.scene = scene;
        this.nodes = new Map<string, THREE.Object3D>();
        this.labels = new Map<string, HTMLElement>();
        this.labelContainer = labelContainer;
        this.links = [];
        this.forces = {
            gravity: 0.02,
            repulsion: 0.8,
            damping: 0.90,	
            centerAttraction: 0.001,
            linkStrength: 0.03
        };
        this.isRunning = false;
        this.animationId = null;
        this.particleSystem = new LinkParticleSystem(scene);
        this.colorPulseData = new Map();
        this.nodeFilePaths = new Map<string, string>();
        this.currentSettings = null;
    }

    // Utility methods for label management

    createLabel(text: string): HTMLElement {
        const label = document.createElement('div');
        label.className = 'graph-label';
        label.textContent = text;
        this.labelContainer.appendChild(label);
        return label;
    }

    updateLabelText(nodeTitle: string, newText: string): void {
        const label = this.labels.get(nodeTitle);
        if (label) {
            label.textContent = newText;
        }
    }

    setLabelVisibility(visible: boolean): void {
        for (const [title, label] of this.labels) {
            if (visible) {
                label.classList.remove('hidden');
            } else {
                label.classList.add('hidden');
            }
        }
    }

    removeLabelForNode(nodeTitle: string): void {
        const label = this.labels.get(nodeTitle);
        if (label) {
            this.labelContainer.removeChild(label);
            this.labels.delete(nodeTitle);
        }
    }

    addNode(title: string, filePath?: string): void {
        // Create the node mesh
        const geometry = new THREE.SphereGeometry(0.3, 16, 16);
        if (filePath) {this.nodeFilePaths.set(title, filePath);}// Store file path for color calculation
        const nodeColor = this.getNodeColor(title);
        const material = new THREE.MeshStandardMaterial({
            color: nodeColor, // Use your selected color as base
            emissive: nodeColor, // Start with node base color emission
            emissiveIntensity: 0.5,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.noteTitle = title;

        // Add physics properties to the mesh
        (mesh as any).velocity = new THREE.Vector3(0, 0, 0);
        (mesh as any).force = new THREE.Vector3(0, 0, 0);
        (mesh as any).mass = 1;
        
        this.nodes.set(title, mesh);
        this.scene.add(mesh);
        
        // Initialize color pulse data with the correct color
        const baseColor = new THREE.Color(nodeColor);

        //Calculate brighness multiplier with dedicated function
        const multiplier = this.calculateBrightnessMultiplier(baseColor)

        this.colorPulseData.set(title, {
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 1.5,   //Make customizable
            baseColor: new THREE.Color(nodeColor),
            pulseColor: new THREE.Color(nodeColor).multiplyScalar(multiplier),
            emissiveStrenghtMultiplier: multiplier,
        });
    }

    private calculateBrightnessMultiplier(baseColor: THREE.Color): number {

        // Calculate brightness using luminance formula. Darker colors get a big multiplier so they can glow
        // Use a Smooth curve that keeps bright colors at 0x and ramps up for darker colors
        const brightness = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
        const multiplier = 0 + Math.pow(Math.max(0, 0.85 - brightness) / 0.85, 2) * 10;
        return multiplier
    }

    private getNodeColor(nodeTitle: string): number {
        if (!this.currentSettings){
            return 0xffffff;
        }
        
        const filePath = this.nodeFilePaths.get(nodeTitle);
        if (!filePath) return hexToThreeColor(this.currentSettings.defaultNodeColor);
        
        const colorHex = getNodeColorForFile(filePath, this.currentSettings);
        return hexToThreeColor(colorHex);
    }

    updateNodeColors(settings: PluginSettings): void {
        this.currentSettings = settings;
        
        for (const [title, node] of this.nodes) {
            const color = this.getNodeColor(title);
            const threeColor = new THREE.Color(color);
            
            // Update node material - base color AND emissive
            if (node instanceof THREE.Mesh && node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach(mat => {
                        if ('color' in mat && 'emissive' in mat) {
                            (mat as any).color.copy(threeColor); // Set base color
                            (mat as any).emissive.set(threeColor); // Reset emissive to black
                        }
                    });
                } else if ('color' in node.material && 'emissive' in node.material) {
                    (node.material as any).color.copy(threeColor); // Set base color
                    (node.material as any).emissive.set(threeColor); // Reset emissive to black
                }
            }
            // Update pulse data colors
            const pulseData = this.colorPulseData.get(title);
            if (pulseData) {
                const multiplier = this.calculateBrightnessMultiplier(threeColor)
                pulseData.baseColor.copy(threeColor);
                pulseData.pulseColor.copy(threeColor).multiplyScalar(multiplier);
                pulseData.emissiveStrenghtMultiplier = multiplier
            }
        }
    }

    addLink(from: string, to: string): void {
        const fromMesh = this.nodes.get(from);
        const toMesh = this.nodes.get(to);
        if (!fromMesh || !toMesh) return;

        const geometry = new THREE.BufferGeometry().setFromPoints([
            fromMesh.position.clone(),
            toMesh.position.clone()
        ]);

        const material = new THREE.LineBasicMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.4,          
            depthWrite: false,
            depthTest: true,        // Ensure proper rendering
        });

        const line = new THREE.Line(geometry, material);

        // Force render even if camera is close by reducing frustum clipping issues
        line.frustumCulled = false;

        this.links.push({ from: fromMesh, to: toMesh, line: line });
        this.scene.add(line);
        
    }

    initializePositions(): void {
        const spread = 8; // Smaller spread for Obsidian notes
        for (const [title, mesh] of this.nodes) {
            const x = (Math.random() - 0.5) * spread;
            const z = (Math.random() - 0.5) * spread;
            const y = (Math.random() - 0.5) * spread * 0.3;
            mesh.position.set(x, y, z);
        }
    }

    calculateForces(): void {
        // Reset forces
        for (const [title, node] of this.nodes) {
            ((node as any).force as THREE.Vector3).set(0, 0, 0);
        }

        // Repulsion between all nodes
        const nodeArray = Array.from(this.nodes.values());
        for (let i = 0; i < nodeArray.length; i++) {
            for (let j = i + 1; j < nodeArray.length; j++) {
                const nodeA = nodeArray[i];
                const nodeB = nodeArray[j];
                
                const distance = nodeA.position.distanceTo(nodeB.position);
                if (distance < 0.1) continue;
                
                const repulsionForce = this.forces.repulsion / (distance * distance);
                const direction = new THREE.Vector3()
                    .subVectors(nodeA.position, nodeB.position)
                    .normalize()
                    .multiplyScalar(repulsionForce);
                
                ((nodeA as any).force as THREE.Vector3).add(direction);
                ((nodeB as any).force as THREE.Vector3).sub(direction);
            }
        }

        // Attraction along links
        for (const link of this.links) {
            const distance = link.from.position.distanceTo(link.to.position);
            const idealDistance = 2.5; // Ideal distance for Obsidian notes
            
            const springForce = (distance - idealDistance) * this.forces.linkStrength;
            const direction = new THREE.Vector3()
                .subVectors(link.to.position, link.from.position)
                .normalize()
                .multiplyScalar(springForce);
            
            ((link.from as any).force as THREE.Vector3).add(direction);
            ((link.to as any).force as THREE.Vector3).sub(direction);
        }

        // Center attraction
        for (const [title, node] of this.nodes) {
            const centerForce = new THREE.Vector3()
                .copy(node.position)
                .multiplyScalar(-this.forces.centerAttraction);
            ((node as any).force as THREE.Vector3).add(centerForce);
        }
    }

    setParticleSpawnRate(milliseconds: number): void {
        if (this.particleSystem) {
            this.particleSystem.setSpawnRate(milliseconds);
            console.log("Particle count set")
        }
        else {
            console.log("Particle system not initialized")
        }
    }

    setMaxParticles(maxParticles: number): void{
        if (this.particleSystem) {
            this.particleSystem.setMaxParticles(maxParticles);
            console.log("Particle count set")
        }
        else{
            console.log("Particle system not initialized")
        }
    }

    setParticlesShuffleDelay(delay: number): void{
        if (this.particleSystem) {
            this.particleSystem.setParticlesShuffleDelay(delay);
            console.log("Particle shuffle delay set")
        }
        else{
            console.log("Particle system not initialized")
        }
    }

    updateParticles(deltaTime: number): void {
        if (this.particleSystem) {
            // Convert links to the format expected by particle system
            const linkData = this.links.map(link => ({
                from: link.from,
                to: link.to
            }));
            this.particleSystem.update(deltaTime, linkData);
        }
    }

    // NEW: Optimized single-loop update method that combines all node operations
    updateAllNodes(camera?: THREE.Camera): void {

        // Pre-calculate connection counts for scaling
        const nodeConnectionCounts = new Map<string, number>();
        for (const link of this.links) {
            // Find node titles by reverse lookup
            let fromTitle = '';
            let toTitle = '';
            
            for (const [title, node] of this.nodes) {
                if (node === link.from) fromTitle = title;
                if (node === link.to) toTitle = title;
            }
            
            if (fromTitle && toTitle) {
                nodeConnectionCounts.set(fromTitle, (nodeConnectionCounts.get(fromTitle) || 0) + 1);
                nodeConnectionCounts.set(toTitle, (nodeConnectionCounts.get(toTitle) || 0) + 1);
            }
        }

        // Prepare for label visibility tracking
        const visibleLabels = new Set<string>();
        const canvas = camera ? this.labelContainer.parentElement : null;
        const rect = canvas ? canvas.getBoundingClientRect() : null;

        // SINGLE LOOP: Process all node updates in one iteration
        for (const [title, node] of this.nodes) {
            // 1. UPDATE POSITIONS (from updatePositions logic)
            const velocity = (node as any).velocity as THREE.Vector3;
            const force = (node as any).force as THREE.Vector3;

            velocity.add(force);
            velocity.multiplyScalar(this.forces.damping);

            // Clamp tiny movements
            if (velocity.lengthSq() < this.velocityTreshold * this.velocityTreshold) {
                velocity.set(0, 0, 0);
            }

            node.position.add(velocity);

            // 2. UPDATE COLORS (modified to use folder-based colors)
            const pulseData = this.colorPulseData.get(title);
            if (pulseData) {
                // Update phase
                pulseData.phase += pulseData.speed * 0.016;
                
                // Calculate pulse factor (0 to 1)
                const pulseFactor = (Math.sin(pulseData.phase) + 1) * 0.5;
                
                // Interpolate between base color and pulse color
                
                //const currentColor = new THREE.Color(); //To make: avoid creating a new obj every frame
                //currentColor.lerpColors(pulseData.baseColor, pulseData.pulseColor, pulseFactor); //Disabled since color pusling has been disabled
                
                // Apply color to node material emissive and emissive intensity
                if (node instanceof THREE.Mesh && node.material) {
                    if (Array.isArray(node.material)) {
                        node.material.forEach(mat => {
                            if ('emissive' in mat && 'emissiveIntensity' in mat) {
                                //(mat as any).color.copy(currentColor); To change base color
                                //(mat as any).emissive.copy(currentColor); To change pulsing color
                                (mat as any).emissiveIntensity = pulseFactor * pulseData.emissiveStrenghtMultiplier; // between 0 and 1 multiplied for a factor that makes darker color glow
                            }
                        });
                    } else if ('emissive' in node.material && 'emissiveIntensity' in node.material) {
                        //(node.material as any).color.copy(currentColor); To change base color
                        //(node.material as any).emissive.copy(currentColor); To change pulsing color
                        (node.material as any).emissiveIntensity = pulseFactor * pulseData.emissiveStrenghtMultiplier; // between 0 and 1, multiplied by a factor
                    }
                }
            }

            // 3. UPDATE NODE SCALES (from updateNodeScales logic)
            const connectionCount = nodeConnectionCounts.get(title) || 0;
            const scale = this.baseNodeScale + (connectionCount * this.linkScaleMultiplier);
            node.scale.set(scale, scale, scale);

            // 4. UPDATE LABELS (from updateLabels logic)
            if (camera && rect) {
                // Calculate distance and visibility
                const distanceToCamera = camera.position.distanceTo(node.position);
                const nodePosition = node.position.clone();
                nodePosition.y += node.scale.x * 0.6 + 0.3;
                const screenPosition = nodePosition.clone().project(camera);
                
                const shouldBeVisible = distanceToCamera <= this.maxVisibleDistance && screenPosition.z < 1;
                
                if (shouldBeVisible) {
                    visibleLabels.add(title);
                    
                    // Create label if it doesn't exist
                    if (!this.labels.has(title)) {
                        const label = this.createLabel(title);
                        this.labels.set(title, label);
                    }
                    
                    const label = this.labels.get(title)!;
                    
                    // Project to screen coordinates
                    const x = (screenPosition.x * 0.5 + 0.5) * rect.width;
                    const y = (-screenPosition.y * 0.5 + 0.5) * rect.height;

                    // Position and scale the label
                    label.style.left = `${x}px`;
                    label.style.top = `${y}px`;
                    
                    const labelScale = Math.max(0.5, Math.min(2, this.labelScale / (distanceToCamera * 0.1)));
                    label.style.transform = `translate(-50%, -100%) scale(${labelScale})`;
                    
                    // Fade based on distance
                    const fadeStart = this.maxVisibleDistance * 0.6;
                    if (distanceToCamera > fadeStart) {
                        const fadeAmount = 1 - (distanceToCamera - fadeStart) / (this.maxVisibleDistance - fadeStart);
                        label.style.opacity = fadeAmount.toString();
                    } else {
                        label.style.opacity = '1';
                    }
                    
                    label.classList.remove('hidden');
                }
            }
        }

        // Clean up labels that are no longer visible (from updateLabels logic)
        if (camera) {
            for (const [title, label] of this.labels) {
                if (!visibleLabels.has(title)) {
                    this.labelContainer.removeChild(label);
                    this.labels.delete(title);
                }
            }
        }

        // Update link lines (this still needs to be separate as it operates on links, not nodes)
        for (const link of this.links) {
            const points = [link.from.position, link.to.position];
            link.line.geometry.setFromPoints(points);
        }
    }

    // UPDATED: Optimized animate method using the single loop
    animate = (camera?: THREE.Camera): void => {
        if (!this.isRunning) return;

        this.calculateForces();
        this.updateAllNodes(camera); // Single optimized call instead of multiple separate calls

        this.animationId = requestAnimationFrame(() => this.animate(camera));
    }

    start(camera?: THREE.Camera): void {
        this.isRunning = true;
        this.animate(camera);
    }

    stop(): void {
        this.isRunning = false;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }
    }

    setForceStrength(type: keyof typeof this.forces, value: number): void {
        this.forces[type] = value;
    }

    getNodeConnectionCount(nodeTitle: string): number {
        return this.links.filter(link => {
            const fromTitle = this.getNodeTitle(link.from);
            const toTitle = this.getNodeTitle(link.to);
            return fromTitle === nodeTitle || toTitle === nodeTitle;
        }).length;
    }

    private getNodeTitle(node: THREE.Object3D): string {
        for (const [title, nodeObj] of this.nodes) {
            if (nodeObj === node) return title;
        }
        return '';
    }
}

class LinkParticleSystem {
    scene: THREE.Scene;
    particles: Array<{
        mesh: THREE.Mesh;
        link: {from: THREE.Object3D, to: THREE.Object3D};
        progress: number;
        speed: number;
        direction: number; // 1 for forward, -1 for reverse
    }>;
    particlePool: THREE.Mesh[];
    maxParticles: number;
    spawnRate: number;
    lastSpawn: number;
    particlesDelay: number;

    constructor(scene: THREE.Scene, maxParticles: number = 5000) {
        this.scene = scene;
        this.particles = [];
        this.particlePool = [];
        this.maxParticles = maxParticles;
        this.spawnRate = 1000; // milliseconds between spawns
        this.lastSpawn = 0;
        this.initializeParticlePool();
    }

    private initializeParticlePool(): void {
        this.dispose()
        // Pre-create particle meshes for performance
        for (let i = 0; i < this.maxParticles; i++) {
            const geometry = new THREE.SphereGeometry(0.1, 8, 8);
            const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const particle = new THREE.Mesh(geometry, material);
            particle.visible = false;
            this.scene.add(particle);
            this.particlePool.push(particle);
        }
    }

    spawnParticle(link: {from: THREE.Object3D, to: THREE.Object3D}): void {
        if (this.particles.length >= this.maxParticles) return;

        // Get available particle from pool
        const availableParticle = this.particlePool.find(p => !p.visible);
        if (!availableParticle) return;

        // Random direction (forward or reverse)
        //const direction = Math.random() > 0.5 ? 1 : -1;
		const direction = 1 //No reverse
        const startProgress = direction === 1 ? 0 : 1;

        // Create particle data
        const particle = {
            mesh: availableParticle,
            link: link,
            progress: startProgress,
            speed: 0.3 + Math.random() * 0.4, // Random speed between 0.3-0.7
            direction: direction
        };

        // Position particle at start
        this.updateParticlePosition(particle);
        availableParticle.visible = true;

		
        /* Add random color variation
        (availableParticle.material as THREE.MeshBasicMaterial).color.setHSL(
            Math.random(), 
            0.5 + Math.random() * 0.5, 
            0.4 + Math.random() * 0.4
        );
		*/

        this.particles.push(particle);
    }

    private updateParticlePosition(particle: any): void {
        const { link, progress } = particle;
        
        // Interpolate position along the link
        const startPos = particle.direction === 1 ? link.from.position : link.to.position;
        const endPos = particle.direction === 1 ? link.to.position : link.from.position;
        
        particle.mesh.position.lerpVectors(startPos, endPos, progress);
    }

    update(deltaTime: number, links: Array<{from: THREE.Object3D, to: THREE.Object3D}>): void {
        const currentTime = performance.now();

        /* Spawn new particle in a random link
        if (currentTime - this.lastSpawn > this.spawnRate && links.length > 0) {
            const randomLink = links[Math.floor(Math.random() * links.length)];
            this.spawnParticle(randomLink);
            this.lastSpawn = currentTime;
        }
        */

        // Spawn particles in all links
        if (currentTime - this.lastSpawn > this.spawnRate && links.length > 0) {
            links.forEach((link, index) => {
                setTimeout(() => {
                    this.spawnParticle(link);
                }, index * this.particlesDelay);
            });
            this.lastSpawn = currentTime;
        }

        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            
            // Update progress
            particle.progress += particle.speed * deltaTime * particle.direction;

            // Check if particle reached the end
            if ((particle.direction === 1 && particle.progress >= 1) || 
                (particle.direction === -1 && particle.progress <= 0)) {
                
                // Remove particle
                particle.mesh.visible = false;
                this.particles.splice(i, 1);
                continue;
            }

            // Update position
            this.updateParticlePosition(particle);

            // Add some pulsing effect
            const pulse = 1 + 0.3 * Math.sin(currentTime * 0.005 + i);
            particle.mesh.scale.setScalar(pulse);
        }
    }

    // Method to adjust spawn rate
    setSpawnRate(milliseconds: number): void {
        this.spawnRate = milliseconds;
    }

	setMaxParticles(maxParticles: number): void{
		this.maxParticles = maxParticles;
        this.initializeParticlePool();
	}

    setParticlesShuffleDelay(delay: number): void{
		this.particlesDelay = delay;
	}

    clearParticles(): void {
        for (const particle of this.particles) {
            particle.mesh.visible = false;
        }
        this.particles = [];
    }

    // Cleanup method
    dispose(): void {
        this.clearParticles();
        for (const mesh of this.particlePool) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        }
        this.particlePool = [];
    }
}
