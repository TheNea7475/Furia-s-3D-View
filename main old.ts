import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, TFile, TAbstractFile, View} from 'obsidian';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';



// Remember to rename these classes and interfaces!
// Constants
const VIEW_TYPE_3D_GRAPH = "3d-graph-view";

class PhysicsMesh extends THREE.Mesh {
    velocity: THREE.Vector3;
    force: THREE.Vector3;
    mass: number;

    constructor(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) {
        super(geometry, material);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.force = new THREE.Vector3(0, 0, 0);
        this.mass = 1;
    }
}

interface PluginSettings {
    forces: {
        repulsion: number;
        friction: number;
        centerAttraction: number;
        linkStrength: number;
    };
    maxSpeed: number;
    freeze: boolean;
    maxVisibleDistance: number;
    labelScale: number;
    baseNodeScale: number;
    autoFocus: boolean;
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
        repulsion: 0.8,
        friction: 0.05,
        centerAttraction: 0.001,
        linkStrength: 0.03
    },
    maxSpeed: 2.0,
    freeze: false,
    maxVisibleDistance: 15,
    labelScale: 0.05,
    baseNodeScale: 1,
    autoFocus: true,
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
				view.plugin = plugin; //Removed cast to any, idk why it was there
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
				repulsion: this.settings.forces.repulsion,
				friction: this.settings.forces.friction,
				centerAttraction: this.settings.forces.centerAttraction,
				linkStrength: this.settings.forces.linkStrength
			};
			
			// Update max speed
			this.graphView.gravityGraph.maxSpeed = this.settings.maxSpeed;
			
			// Update freeze setting
			this.graphView.gravityGraph.freeze = this.settings.freeze;
			// Clear frozen nodes when disabling freeze
			if (!this.settings.freeze) {
				this.graphView.gravityGraph.frozenNodes.clear();
			}


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
							repulsion: 0.8,
							friction: 0.05,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.repulsion = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Friction setting
		new Setting(containerEl)
			.setName('Friction')
			.setDesc('Controls velocity decay based on speed (0 = no friction, higher = more friction)')
			.addSlider(slider => slider
				.setLimits(0, 0.2, 0.001)
				.setValue(this.plugin.settings.forces?.friction ?? 0.05)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							repulsion: 0.8,
							friction: 0.05,
							centerAttraction: 0.001,
							linkStrength: 0.03
						};
					}
					this.plugin.settings.forces.friction = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Max Speed setting
		new Setting(containerEl)
			.setName('Max Speed')
			.setDesc('Maximum movement speed for nodes (prevents crashes and weird behavior)')
			.addSlider(slider => slider
				.setLimits(0.1, 10, 0.1)
				.setValue(this.plugin.settings.maxSpeed ?? 2.0)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxSpeed = value;
					await this.plugin.saveSettings();
					this.plugin.updateSettingsParameters();
				}));

		// Freeze setting
		new Setting(containerEl)
			.setName('Freeze Nodes')
			.setDesc('Lock in place nodes that are moving slowly and not affected by significant forces')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.freeze ?? false)
				.onChange(async (value) => {
					this.plugin.settings.freeze = value;
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
							repulsion: 0.8,
							friction: 0.05,
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
				.setLimits(0.1, 10, 0.1) // was 1-10
				.setValue(this.plugin.settings.forces?.linkStrength*100)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (!this.plugin.settings.forces) {
						this.plugin.settings.forces = {
							repulsion: 0.8,
							friction: 0.05,
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
						repulsion: 0.8,
						friction: 0.05,
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

                new Setting(containerEl)
                    .setName('Auto Focus')
                    .setDesc("Automatically focus a node when it's note is clicked")
                    .addToggle(toggle => toggle
                        .setValue(this.plugin.settings.autoFocus)
                        .onChange(async (value) => {
                            this.plugin.settings.autoFocus = value;
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
    private focusHalos: THREE.Mesh[] | null = null;
	activeLeafChangeHandler: () => void;
    resizeObserver: ResizeObserver;
    private resizeTimeout: number | null = null;
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
    private previousLinks = new Map<string, string[]>();
    
    // NEW: Add mapping to handle duplicate names
    private pathToUniqueId = new Map<string, string>();
    private uniqueIdToPath = new Map<string, string>();
    private nodeNameCounter = new Map<string, number>();

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

    // NEW: Generate unique ID for nodes with duplicate names
    private generateUniqueNodeId(basename: string, path: string): string {
        // Check if this exact path already has an ID
        if (this.pathToUniqueId.has(path)) {
            return this.pathToUniqueId.get(path)!;
        }

        // Count how many nodes with this basename we've seen
        const count = this.nodeNameCounter.get(basename) || 0;
        this.nodeNameCounter.set(basename, count + 1);
        
        let uniqueId: string;
        if (count === 0) {
            // First occurrence, use the basename as-is
            uniqueId = basename;
        } else {
            // Subsequent occurrences, append a counter or use folder name
            const folderName = path.split('/').slice(-2, -1)[0] || 'root';
            uniqueId = `${basename} (${folderName})`;
            
            // If this ID already exists, add a number
            let counter = 1;
            let testId = uniqueId;
            while (this.uniqueIdToPath.has(testId)) {
                testId = `${uniqueId} ${counter}`;
                counter++;
            }
            uniqueId = testId;
        }

        // Store the mappings
        this.pathToUniqueId.set(path, uniqueId);
        this.uniqueIdToPath.set(uniqueId, path);
        
        return uniqueId;
    }

    // NEW: Get unique ID from path
    private getUniqueIdFromPath(path: string): string | null {
        return this.pathToUniqueId.get(path) || null;
    }

    // NEW: Get path from unique ID
    private getPathFromUniqueId(uniqueId: string): string | null {
        return this.uniqueIdToPath.get(uniqueId) || null;
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

		// MODIFIED: Collect all links using unique IDs
		for (const file of files) {
			const path = file.path;
			const basename = file.basename;
            const uniqueId = this.generateUniqueNodeId(basename, path);
            
			// Get links from frontmatter and wikilinks
			const resolvedLinks = metadataCache.resolvedLinks[path];
			if (resolvedLinks) {
				for (const target in resolvedLinks) {
					const targetFile = this.app.metadataCache.getFirstLinkpathDest(target, path);
					if (targetFile) {
                        const targetUniqueId = this.generateUniqueNodeId(targetFile.basename, targetFile.path);
						links.push([uniqueId, targetUniqueId]);
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
			
			this.renderer = new THREE.WebGLRenderer({ 
                canvas, 
                antialias: true,
                powerPreference: 'high-performance', // Use dedicated GPU if available
                stencil: false, // Disable stencil buffer for performance
                depth: true
            });
			this.renderer.setSize(width, height);
			this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2 for performance
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

			// Listen for active leaf changes, used for auto node focusing
			this.activeLeafChangeHandler = () => {
				const activeNoteName = this.getCurrentActiveNote();
                const activeNotePath = this.getCurrentActiveNotePath();
				if (activeNoteName && activeNotePath) {
                    const uniqueId = this.getUniqueIdFromPath(activeNotePath);
                    if (uniqueId) {
                        this.setFocusedNodeByUniqueId(uniqueId);
                        if (this.plugin.settings.autoFocus) {
                            this.focusOnNodeByUniqueId(uniqueId);
                        }
                    }
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
                
                this.glowFocusedNode();
                this.gravityGraph.updateParticles(deltaTime);
                this.composer.render(); // Single render call
                
                this.animationFrameId = requestAnimationFrame(animate);
            };
			animate();

			// Event listeners

            // Listener for zoom-to-move logic. instead of zooming move in 3d
            this.renderer.domElement.addEventListener('wheel', this.handleWheelMovement);

            // Use ResizeObserver to detect container size changes (panel collapse/expand)
            // Note: handleResize has built-in debouncing, so this can fire frequently
            this.resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });

            this.resizeObserver.observe(container);

		}, 100); //scene rendering delay
    
        // Setting up listeners
        this.setupLiveUpdates();
	}

    // MODIFIED: Graph used methods with unique IDs
    startNodeAddition = () => {
        const addNextNode = () => {
            if (this.currentNodeIndex < this.allFiles.length) {
                const file = this.allFiles[this.currentNodeIndex];
                const uniqueId = this.generateUniqueNodeId(file.basename, file.path);
                
                // Store the original basename in userData for display
                this.gravityGraph.addNode(uniqueId, file.path, file.basename);
                
                // Get the newly added node and give it a random position
                const newNode = this.gravityGraph.nodes.get(uniqueId);
                if (newNode) {
                    // Random position in a sphere around origin
                    const spread = 8; // Same as initializePositions spread
                    const x = (Math.random() - 0.5) * spread;
                    const z = (Math.random() - 0.5) * spread;
                    const y = (Math.random() - 0.5) * spread * 0.3;
                    
                    newNode.position.set(x, y, z);
                    
                    // Store the display name in userData
                    newNode.userData.noteTitle = file.basename;
                    newNode.userData.uniqueId = uniqueId;
                    newNode.userData.filePath = file.path;
                    
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
                const [fromUniqueId, toUniqueId] = this.allLinks[this.currentLinkIndex];
                this.gravityGraph.addLink(fromUniqueId, toUniqueId);
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

                    // Apply wheel damping
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
        // Debounce resize - only execute after user stops resizing
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        
        this.resizeTimeout = window.setTimeout(() => {
            if (!this.renderer || !this.camera || !this.composer) return;
            
            const container = this.containerEl.children[1] as HTMLElement;
            if (!container) return;
            
            const width = container.offsetWidth || 600;
            const height = container.offsetHeight || 400;
            
            // Update renderer
            this.renderer.setSize(width, height, false); // false = don't update style
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2 for performance
            
            // Update camera
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            
            // Update composer
            this.composer.setSize(width, height);
            this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            
            this.resizeTimeout = null;
        }, 150); // Debounce delay - adjust based on performance needs
	};

    focusOnNode(targetNode: THREE.Object3D): void {
        // Use the display name for the notice
        const displayName = targetNode.userData.noteTitle || targetNode.userData.uniqueId;
        new Notice(displayName);

        // Disable standard controls
        this.controls.enabled = false;
        this.controls.autoRotate = false;
        
        const distance = 6;
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
            
            this.composer.render()
            requestAnimationFrame(animate);
        };
        
        animate();
    }

	getCurrentActiveNote(): string | null {
        const activeLeafView = this.app.workspace.getActiveViewOfType(MarkdownView) // Removed use of deprecated view system
		if (activeLeafView?.getViewType() === 'markdown') {
			const markdownView = activeLeafView as MarkdownView;
			return markdownView.file?.basename || null;
		}
		return null;
	}

    // NEW: Get current active note path
    getCurrentActiveNotePath(): string | null {
        const activeLeafView = this.app.workspace.getActiveViewOfType(MarkdownView) // Removed use of deprecated view system
		if (activeLeafView?.getViewType() === 'markdown') {
			const markdownView = activeLeafView as MarkdownView;
			return markdownView.file?.path || null;
		}
		return null;
	}

    // MODIFIED: Set focused node by unique ID instead of name
    setFocusedNodeByUniqueId(uniqueId: string): void {
        const targetNode = this.gravityGraph.nodes.get(uniqueId);
        if (targetNode) {
            this.focusedNode = targetNode;
        }
    }

    // MODIFIED: Focus on node by unique ID instead of name
	focusOnNodeByUniqueId(uniqueId: string): void {
		const targetNode = this.gravityGraph.nodes.get(uniqueId);
		if (targetNode) {
			this.focusOnNode(targetNode);
		}
	}

    // Keep the old methods for backward compatibility, but use path-based lookup
    setFocusedNodeByName(noteName: string): void {
        // Try to find by note name, but this may not work correctly with duplicates
        const targetNode = Array.from(this.gravityGraph.nodes.values())
            .find(node => node.userData.noteTitle === noteName);
        if (targetNode) {
            this.focusedNode = targetNode;
        }
    }

    focusOnNodeByName(noteName: string): void {
        // Try to find by note name, but this may not work correctly with duplicates
        const targetNode = Array.from(this.gravityGraph.nodes.values())
            .find(node => node.userData.noteTitle === noteName);
        
        if (targetNode) {
            this.focusOnNode(targetNode);
        }
    }

    glowFocusedNode(): void {
        if (this.focusedNode) {
            // Create halos if they don't exist
            if (!this.focusHalos) {
                this.focusHalos = [];
                const numHalos = 3; // Number of halos
                const softGray = 0x888888; // Soft gray color
                
                for (let i = 0; i < numHalos; i++) {
                    // Create smaller halos with varying sizes
                    const innerRadius = 0.8 + i * 0.2; // 0.8, 1.0, 1.2
                    const outerRadius = innerRadius + 0.15; // Thin rings
                    
                    const haloGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 64);
                    const haloMaterial = new THREE.MeshBasicMaterial({
                        color: softGray,
                        transparent: true,
                        opacity: 0.4 - i * 0.1, // Decreasing opacity for outer halos
                        side: THREE.DoubleSide
                    });
                    
                    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
                    
                    // Set different initial rotations and rotation speeds
                    halo.userData = {
                        rotationSpeedY: 0.02 + i * 0.015, // Different Y rotation speeds
                        rotationSpeedX: 0.01 + i * 0.01,  // Different X rotation speeds
                        rotationSpeedZ: 0.005 + i * 0.008, // Different Z rotation speeds
                        initialRotationY: (i * Math.PI * 2) / numHalos, // Spread initial rotations
                        initialRotationX: (i * Math.PI) / numHalos,
                        initialRotationZ: (i * Math.PI * 1.5) / numHalos
                    };
                    
                    // Set initial rotations
                    halo.rotation.y = halo.userData.initialRotationY;
                    halo.rotation.x = halo.userData.initialRotationX;
                    halo.rotation.z = halo.userData.initialRotationZ;
                    
                    this.focusHalos.push(halo);
                    this.scene.add(halo);
                }
            }
            
            // Update all halos
            this.focusHalos.forEach((halo) => {
                // Position halo at focused node
                halo.position.copy(this.focusedNode.position);

                // Calculate distance from camera to focused node
                const distance = this.camera.position.distanceTo(this.focusedNode.position);
                
                // Scale halo based on camera distance
                const minScale = 0.5;     // Minimum scale when very close
                const maxScale = 10.0;     // Maximum scale when far away
                const scaleDistance = 200; // Distance at which scale reaches maximum
                
                // Linear scaling
                const normalizedDistance = Math.min(distance / scaleDistance, 1.0);
                const scale = minScale + (maxScale - minScale) * normalizedDistance;
                
                halo.scale.setScalar(scale);

                // Animate each halo with its own rotation speeds
                halo.rotation.y += halo.userData.rotationSpeedY;
                halo.rotation.x += halo.userData.rotationSpeedX;
                halo.rotation.z += halo.userData.rotationSpeedZ;
            });
            
        } else {
            // Remove halos when not focusing
            if (this.focusHalos) {
                this.focusHalos.forEach((halo) => {
                    this.scene.remove(halo);
                    halo.geometry.dispose();
                    (halo.material as THREE.Material).dispose();
                });
                this.focusHalos = null;
            }
        }
    }

    private setupLiveUpdates() {
        // Listener per nuove note
        this.registerEvent(
            this.app.vault.on('create', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.onNewNoteCreated(file);
                }
            })
        );

        // Listener per modifiche (per intercettare nuovi link)
        this.registerEvent(
            this.app.vault.on('modify', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.checkForNewLinks(file);
                }
            })
        );

        // Listener per note eliminate
        this.registerEvent(
            this.app.vault.on('delete', (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.onNoteDeleted(file);
                }
            })
        );

        // Listener per note rinominate
        this.registerEvent(
            this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.onNoteRenamed(file, oldPath);
                }
            })
        );

        // Inizializza la cache dei link esistenti
        this.initializeLinkCache();
    }

    // MODIFIED: Live updates methods with unique IDs
    private async onNewNoteCreated(file: TFile) {
        if (!this.gravityGraph) return;

        const uniqueId = this.generateUniqueNodeId(file.basename, file.path);
        console.log('Nuova nota creata:', uniqueId, 'path:', file.path);

        // Aggiungi il nodo al grafo con unique ID
        this.gravityGraph.addNode(uniqueId, file.path, file.basename);

        // Set userData properly
        const node = this.gravityGraph.nodes.get(uniqueId);
        if (node) {
            node.userData.noteTitle = file.basename;
            node.userData.uniqueId = uniqueId;
            node.userData.filePath = file.path;
        }

        // Leggi il contenuto per eventuali link esistenti
        try {
            const content = await this.app.vault.read(file);
            const links = this.extractLinks(content);
            
            // Aggiungi i link se esistono nodi corrispondenti
            for (const linkTarget of links) {
                // Find the target node by trying to resolve the link
                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
                if (targetFile) {
                    const targetUniqueId = this.getUniqueIdFromPath(targetFile.path);
                    if (targetUniqueId && this.gravityGraph.hasNode(targetUniqueId)) {
                        this.gravityGraph.addLink(uniqueId, targetUniqueId);
                    }
                }
            }

            // Aggiorna la cache dei link
            this.previousLinks.set(file.path, links);

            // Reinizializza la posizione del nuovo nodo
            this.initializeNewNodePosition(uniqueId);

        } catch (error) {
            console.error('Errore nella lettura della nuova nota:', error);
        }
    }

    private async checkForNewLinks(file: TFile) {
        if (!this.gravityGraph) return;

        try {
            const content = await this.app.vault.read(file);
            const currentLinks = this.extractLinks(content);
            const previousLinks = this.previousLinks.get(file.path) || [];
            
            // Trova i nuovi link
            const newLinks = currentLinks.filter(link => !previousLinks.includes(link));
            const removedLinks = previousLinks.filter(link => !currentLinks.includes(link));
            
            const uniqueId = this.getUniqueIdFromPath(file.path);
            if (!uniqueId) return;

            // Aggiungi nuovi link
            for (const linkTarget of newLinks) {
                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
                if (targetFile) {
                    const targetUniqueId = this.getUniqueIdFromPath(targetFile.path);
                    if (targetUniqueId && this.gravityGraph.hasNode(targetUniqueId)) {
                        this.gravityGraph.addLink(uniqueId, targetUniqueId);
                        console.log(`Nuovo link aggiunto: ${uniqueId} -> ${targetUniqueId}`);
                    }
                }
            }

            // Rimuovi link eliminati
            for (const linkTarget of removedLinks) {
                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
                if (targetFile) {
                    const targetUniqueId = this.getUniqueIdFromPath(targetFile.path);
                    if (targetUniqueId) {
                        this.gravityGraph.removeLink(uniqueId, targetUniqueId);
                        console.log(`Link rimosso: ${uniqueId} -> ${targetUniqueId}`);
                    }
                }
            }
            
            // Aggiorna la cache
            this.previousLinks.set(file.path, currentLinks);

        } catch (error) {
            console.error('Errore nel controllo dei link:', error);
        }
    }

    private onNoteDeleted(file: TFile) {
        if (!this.gravityGraph) return;

        const uniqueId = this.getUniqueIdFromPath(file.path);
        if (!uniqueId) return;

        console.log('Nota eliminata:', uniqueId);

        // Rimuovi il nodo dal grafo
        this.gravityGraph.removeNode(uniqueId);

        // Rimuovi dalla cache
        this.previousLinks.delete(file.path);
        
        // Clean up mappings
        this.pathToUniqueId.delete(file.path);
        this.uniqueIdToPath.delete(uniqueId);
        
        // Update name counter
        const basename = file.basename;
        const count = this.nodeNameCounter.get(basename) || 0;
        if (count > 1) {
            this.nodeNameCounter.set(basename, count - 1);
        } else {
            this.nodeNameCounter.delete(basename);
        }
    }

    private onNoteRenamed(file: TFile, oldPath: string) {
        if (!this.gravityGraph) return;

        const oldUniqueId = this.getUniqueIdFromPath(oldPath);
        if (!oldUniqueId) return;

        // Generate new unique ID for the renamed file
        const newUniqueId = this.generateUniqueNodeId(file.basename, file.path);

        console.log(`Nota rinominata: ${oldUniqueId} -> ${newUniqueId}`);

        // Rinomina il nodo nel grafo
        this.gravityGraph.renameNode(oldUniqueId, newUniqueId, file.path);

        // Update mappings
        this.pathToUniqueId.delete(oldPath);
        this.uniqueIdToPath.delete(oldUniqueId);
        this.pathToUniqueId.set(file.path, newUniqueId);
        this.uniqueIdToPath.set(newUniqueId, file.path);

        // Update node userData
        const node = this.gravityGraph.nodes.get(newUniqueId);
        if (node) {
            node.userData.noteTitle = file.basename;
            node.userData.uniqueId = newUniqueId;
            node.userData.filePath = file.path;
        }

        // Aggiorna la cache
        const links = this.previousLinks.get(oldPath);
        if (links) {
            this.previousLinks.delete(oldPath);
            this.previousLinks.set(file.path, links);
        }
    }

    private extractLinks(content: string): string[] {
        // Regex per link interni [[...]] 
        const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        const links: string[] = [];
        let match;
        
        while ((match = wikiLinkRegex.exec(content)) !== null) {
            let linkTarget = match[1];
            
            // Rimuovi l'estensione .md se presente
            if (linkTarget.endsWith('.md')) {
                linkTarget = linkTarget.slice(0, -3);
            }
            
            // Prendi solo il nome del file se è un percorso completo
            if (linkTarget.includes('/')) {
                linkTarget = linkTarget.split('/').pop() || linkTarget;
            }
            
            links.push(linkTarget);
        }
        
        return links;
    }

    private initializeNewNodePosition(uniqueId: string) {
        if (!this.gravityGraph) return;

        const node = this.gravityGraph.getNode(uniqueId);
        if (!node) return;

        // Posiziona il nuovo nodo in una posizione casuale ma non troppo lontana
        const spread = 4;
        const x = (Math.random() - 0.5) * spread;
        const z = (Math.random() - 0.5) * spread;
        const y = (Math.random() - 0.5) * spread * 0.3;
        
        node.position.set(x, y, z);

        // Inizializza velocità e forza
        (node as any).velocity = new THREE.Vector3(0, 0, 0);
        (node as any).force = new THREE.Vector3(0, 0, 0);
    }

    private async initializeLinkCache() {
        console.log('Inizializzazione cache dei link...');
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        for (const file of markdownFiles) {
            try {
                const content = await this.app.vault.read(file);
                const links = this.extractLinks(content);
                this.previousLinks.set(file.path, links);
            } catch (error) {
                console.error(`Errore nella lettura del file ${file.path}:`, error);
            }
        }
        
        console.log(`Cache inizializzata per ${markdownFiles.length} file`);
    }

    // Metodo pubblico per inizializzare tutto dopo che il grafo è pronto
    async initializeGraph(gravityGraph: GravityGraph) {
        this.gravityGraph = gravityGraph;
        await this.initializeLinkCache();
        console.log('GraphView pronto per aggiornamenti live');
    }

    // NEW: Method to get all nodes with duplicate names for debugging
    getNodeDuplicateInfo(): {[basename: string]: {uniqueId: string, path: string}[]} {
        const duplicateInfo: {[basename: string]: {uniqueId: string, path: string}[]} = {};
        
        for (const [path, uniqueId] of this.pathToUniqueId.entries()) {
            const basename = path.split('/').pop()?.replace('.md', '') || '';
            
            if (!duplicateInfo[basename]) {
                duplicateInfo[basename] = [];
            }
            
            duplicateInfo[basename].push({ uniqueId, path });
        }
        
        // Only return entries with more than one instance
        const result: {[basename: string]: {uniqueId: string, path: string}[]} = {};
        for (const [basename, instances] of Object.entries(duplicateInfo)) {
            if (instances.length > 1) {
                result[basename] = instances;
            }
        }
        
        return result;
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
        
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
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

        // Clean up mappings
        this.pathToUniqueId.clear();
        this.uniqueIdToPath.clear();
        this.nodeNameCounter.clear();
        this.previousLinks.clear();
	}
}

// Updated GravityGraph class that handles node creation internally
class GravityGraph {
    scene: THREE.Scene;
    nodes: Map<string, PhysicsMesh>;
    labels: Map<string, HTMLElement>;
    labelContainer: HTMLElement;
    links: Array<{from: PhysicsMesh, to: PhysicsMesh, line: THREE.Line}>;
    forces: {
        repulsion: number;
        friction: number;
        centerAttraction: number;
        linkStrength: number;
    };
    maxSpeed: number;
    freeze: boolean;
    frozenNodes: Set<string>; // Track which nodes are frozen
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
    
    // Performance optimization: reverse lookup map for node to uniqueId
    private nodeToUniqueId: Map<PhysicsMesh, string>;
    
    // Shared geometry for all nodes (memory optimization)
    private sharedNodeGeometry: THREE.SphereGeometry;

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
        this.nodes = new Map<string, PhysicsMesh>();
        this.labels = new Map<string, HTMLElement>();
        this.labelContainer = labelContainer;
        this.links = [];
        this.forces = {
            repulsion: 0.8,
            friction: 0.05,	
            centerAttraction: 0.001,
            linkStrength: 0.03
        };
        this.maxSpeed = 2.0;
        this.freeze = false;
        this.frozenNodes = new Set<string>();
        this.isRunning = false;
        this.animationId = null;
        this.particleSystem = new LinkParticleSystem(scene);
        this.colorPulseData = new Map();
        this.nodeFilePaths = new Map<string, string>();
        this.nodeToUniqueId = new Map<PhysicsMesh, string>();
        this.currentSettings = null;
        
        // Create shared geometry for all nodes (reduces memory usage significantly)
        this.sharedNodeGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    }

    // Utility methods for label management

    createLabel(text: string, uniqueId: string): HTMLElement {
        const label = document.createElement('div');
        label.className = 'graph-label';
        label.textContent = text;
        label.setAttribute('data-unique-id', uniqueId); // Store unique ID for reference
        
        // Only set positioning - let CSS handle everything else
        label.style.position = 'absolute';
        
        this.labelContainer.appendChild(label);
        return label;
    }

    updateLabelText(uniqueId: string, newText: string): void {
        const label = this.labels.get(uniqueId);
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

    removeLabelForNode(uniqueId: string): void {
        const label = this.labels.get(uniqueId);
        if (label) {
            this.labelContainer.removeChild(label);
            this.labels.delete(uniqueId);
        }
    }

    addNode(uniqueId: string, filePath?: string, displayName?: string): void {
        // Use displayName for visual purposes, uniqueId for internal tracking
        const nodeTitle = displayName || uniqueId;
        
        // Use shared geometry for all nodes (memory optimization)
        if (filePath) {
            this.nodeFilePaths.set(uniqueId, filePath); // Use unique ID as key
        }
        
        const nodeColor = this.getNodeColor(uniqueId); // Pass unique ID
        const material = new THREE.MeshStandardMaterial({
            color: nodeColor,
            emissive: nodeColor,
            emissiveIntensity: 0.5,
        });

        const mesh = new PhysicsMesh(this.sharedNodeGeometry, material);
        
        // Store both unique ID and display name in userData
        mesh.userData.noteTitle = nodeTitle; // Display name for UI
        mesh.userData.uniqueId = uniqueId;   // Unique ID for tracking
        mesh.userData.filePath = filePath;   // File path for reference

        
        this.nodes.set(uniqueId, mesh); // Use unique ID as key
        this.nodeToUniqueId.set(mesh, uniqueId); // Add reverse lookup for performance
        this.scene.add(mesh);
        
        // Initialize color pulse data with unique ID as key
        const baseColor = new THREE.Color(nodeColor);
        const multiplier = this.calculateBrightnessMultiplier(baseColor);

        this.colorPulseData.set(uniqueId, {
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 1.5,
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

    // MODIFIED: Update getNodeColor to work with unique IDs
    private getNodeColor(uniqueId: string): number {
        if (!this.currentSettings) {
            return 0xffffff;
        }
        
        const filePath = this.nodeFilePaths.get(uniqueId); // Use unique ID
        if (!filePath) return hexToThreeColor(this.currentSettings.defaultNodeColor);
        
        const colorHex = getNodeColorForFile(filePath, this.currentSettings);
        return hexToThreeColor(colorHex);
    }

    // MODIFIED: Update updateNodeColors to work with unique IDs
    updateNodeColors(settings: PluginSettings): void {
        this.currentSettings = settings;
        
        for (const [uniqueId, node] of this.nodes) { // uniqueId instead of title
            const color = this.getNodeColor(uniqueId);
            const threeColor = new THREE.Color(color);
            
            // Update node material - base color AND emissive
            if (node instanceof THREE.Mesh && node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach(mat => {
                        if ('color' in mat && 'emissive' in mat) {
                            (mat as any).color.copy(threeColor);
                            (mat as any).emissive.set(threeColor);
                        }
                    });
                } else if ('color' in node.material && 'emissive' in node.material) {
                    (node.material as any).color.copy(threeColor);
                    (node.material as any).emissive.set(threeColor);
                }
            }
            
            // Update pulse data colors
            const pulseData = this.colorPulseData.get(uniqueId); // Use unique ID
            if (pulseData) {
                const multiplier = this.calculateBrightnessMultiplier(threeColor);
                pulseData.baseColor.copy(threeColor);
                pulseData.pulseColor.copy(threeColor).multiplyScalar(multiplier);
                pulseData.emissiveStrenghtMultiplier = multiplier;
            }
        }
    }

    // MODIFIED: Update addLink to work with unique IDs
    addLink(fromUniqueId: string, toUniqueId: string): void {
        const fromMesh = this.nodes.get(fromUniqueId);
        const toMesh = this.nodes.get(toUniqueId);
        if (!fromMesh || !toMesh) return;

        // Check if link already exists to avoid duplicates
        const linkExists = this.links.some(link => 
            (link.from === fromMesh && link.to === toMesh) ||
            (link.from === toMesh && link.to === fromMesh)
        );
        
        if (linkExists) return;

        const geometry = new THREE.BufferGeometry().setFromPoints([
            fromMesh.position.clone(),
            toMesh.position.clone()
        ]);

        const material = new THREE.LineBasicMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            depthTest: true,
        });

        const line = new THREE.Line(geometry, material);
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

    // MODIFIED: Update the optimized updateAllNodes method
    updateAllNodes(camera?: THREE.Camera): void {
        // Pre-calculate connection counts for scaling using unique IDs
        // OPTIMIZED: Use reverse lookup map instead of nested loop
        const nodeConnectionCounts = new Map<string, number>();
        for (const link of this.links) {
            const fromUniqueId = this.nodeToUniqueId.get(link.from);
            const toUniqueId = this.nodeToUniqueId.get(link.to);
            
            if (fromUniqueId && toUniqueId) {
                nodeConnectionCounts.set(fromUniqueId, (nodeConnectionCounts.get(fromUniqueId) || 0) + 1);
                nodeConnectionCounts.set(toUniqueId, (nodeConnectionCounts.get(toUniqueId) || 0) + 1);
            }
        }

        // Prepare for label visibility tracking
        const visibleLabels = new Set<string>();
        const canvas = camera ? this.labelContainer.parentElement : null;
        const rect = canvas ? canvas.getBoundingClientRect() : null;

        // SINGLE LOOP: Process all node updates using unique IDs
        for (const [uniqueId, node] of this.nodes) {
            // Check if node is frozen - skip physics if it is
            const isFrozen = this.frozenNodes.has(uniqueId);
            
            // 1. UPDATE POSITIONS
            const velocity = (node as any).velocity as THREE.Vector3;
            const force = (node as any).force as THREE.Vector3;

            if (!isFrozen) {
                velocity.add(force);
                
                // Apply friction - proportional to speed squared (realistic air resistance)
                if (this.forces.friction > 0) {
                    const speedSq = velocity.lengthSq();
                    if (speedSq > 0.0001) { // Avoid unnecessary calculations for very small speeds
                        const speed = Math.sqrt(speedSq); // Reuse already calculated squared length
                        const frictionMagnitude = this.forces.friction * speedSq; // Use speedSq directly
                        // Modify velocity in-place instead of creating new vectors
                        const frictionScale = 1 - (frictionMagnitude / speed);
                        velocity.multiplyScalar(Math.max(0, frictionScale));
                    }
                }
                
                // Enforce max speed limit
                const currentSpeed = velocity.length();
                if (currentSpeed > this.maxSpeed) {
                    velocity.normalize().multiplyScalar(this.maxSpeed);
                }

                // Check if node should be frozen (if freeze is enabled)
                if (this.freeze) {
                    const speedSq = velocity.lengthSq();
                    const forceSq = force.lengthSq();
                    const freezeThreshold = this.velocityTreshold * this.velocityTreshold;
                    
                    // Freeze if moving slowly and not affected by significant forces
                    if (speedSq < freezeThreshold && forceSq < freezeThreshold * 100) {
                        velocity.set(0, 0, 0);
                        force.set(0, 0, 0);
                        this.frozenNodes.add(uniqueId);
                    }
                } else {
                    // Normal velocity threshold behavior when freeze is disabled
                    if (velocity.lengthSq() < this.velocityTreshold * this.velocityTreshold) {
                        velocity.set(0, 0, 0);
                    }
                }

                node.position.add(velocity);
            } else {
                // Node is frozen - check if it should be unfrozen due to external forces
                if (force.lengthSq() > this.velocityTreshold * this.velocityTreshold * 100) {
                    this.frozenNodes.delete(uniqueId);
                }
            }

            // 2. UPDATE COLORS
            const pulseData = this.colorPulseData.get(uniqueId); // Use unique ID
            if (pulseData) {
                pulseData.phase += pulseData.speed * 0.016;
                const pulseFactor = (Math.sin(pulseData.phase) + 1) * 0.5;
                
                if (node instanceof THREE.Mesh && node.material) {
                    if (Array.isArray(node.material)) {
                        node.material.forEach(mat => {
                            if ('emissive' in mat && 'emissiveIntensity' in mat) {
                                (mat as any).emissiveIntensity = pulseFactor * pulseData.emissiveStrenghtMultiplier;
                            }
                        });
                    } else if ('emissive' in node.material && 'emissiveIntensity' in node.material) {
                        (node.material as any).emissiveIntensity = pulseFactor * pulseData.emissiveStrenghtMultiplier;
                    }
                }
            }

            // 3. UPDATE NODE SCALES
            const connectionCount = nodeConnectionCounts.get(uniqueId) || 0;
            const scale = this.calcLinkScale(connectionCount);
            node.scale.set(scale, scale, scale);

            // 4. UPDATE LABELS - use display name for label text
            if (camera && rect) {
                const distanceToCamera = camera.position.distanceTo(node.position);
                const nodePosition = node.position.clone();
                const screenPosition = nodePosition.clone().project(camera);
                
                const shouldBeVisible = distanceToCamera <= this.maxVisibleDistance && screenPosition.z < 1;
                
                if (shouldBeVisible) {
                    visibleLabels.add(uniqueId);
                    
                    // Create label if it doesn't exist, using display name
                    if (!this.labels.has(uniqueId)) {
                        const displayName = node.userData.noteTitle || uniqueId;
                        const label = this.createLabel(displayName, uniqueId);
                        this.labels.set(uniqueId, label);
                    }
                    
                    const label = this.labels.get(uniqueId)!;
                    
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

        // Clean up labels that are no longer visible
        if (camera) {
            for (const [uniqueId, label] of this.labels) {
                if (!visibleLabels.has(uniqueId)) {
                    this.labelContainer.removeChild(label);
                    this.labels.delete(uniqueId);
                }
            }
        }

        // Update link lines
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

    // MODIFIED: Update getNodeConnectionCount to work with unique IDs
    getNodeConnectionCount(uniqueId: string): number {
        const node = this.nodes.get(uniqueId);
        if (!node) return 0;
        
        return this.links.filter(link => 
            link.from === node || link.to === node
        ).length;
    }

    private getNodeTitle(node: THREE.Object3D): string {
        for (const [title, nodeObj] of this.nodes) {
            if (nodeObj === node) return title;
        }
        return '';
    }

    calcLinkScale(connectionCount: number): number {
        if (connectionCount <= 1) {
            return 1
        }
        else {
            return this.baseNodeScale + (connectionCount * this.linkScaleMultiplier);
        }
    }

    // MODIFIED: Update live update methods to work with unique IDs
    hasNode(uniqueId: string): boolean {
        return this.nodes.has(uniqueId);
    }

    // Ottieni un nodo per titolo
    getNode(uniqueId: string): THREE.Object3D | undefined {
        return this.nodes.get(uniqueId);
    }

    removeNode(uniqueId: string): void {
        const node = this.nodes.get(uniqueId);
        if (!node) return;

        // Remove all links connected to this node
        this.links = this.links.filter(link => {
            const shouldRemove = link.from === node || link.to === node;
            if (shouldRemove) {
                this.scene.remove(link.line);
                // Dispose geometry and material
                link.line.geometry.dispose();
                if (link.line.material instanceof THREE.Material) {
                    link.line.material.dispose();
                }
            }
            return !shouldRemove;
        });

        // Remove the node from scene
        this.scene.remove(node);
        
        // Dispose node material but NOT geometry (it's shared)
        if (node instanceof THREE.Mesh) {
            // Don't dispose geometry - it's shared among all nodes
            if (Array.isArray(node.material)) {
                node.material.forEach(mat => mat.dispose());
            } else {
                node.material.dispose();
            }
        }
        
        this.nodes.delete(uniqueId);
        this.nodeToUniqueId.delete(node); // Clean up reverse lookup

        // Remove color pulse data
        this.colorPulseData.delete(uniqueId);

        // Remove file path
        this.nodeFilePaths.delete(uniqueId);

        // Remove label
        this.removeLabelForNode(uniqueId);

        console.log(`Node removed: ${uniqueId}`);
    }

    removeLink(fromUniqueId: string, toUniqueId: string): void {
        const fromNode = this.nodes.get(fromUniqueId);
        const toNode = this.nodes.get(toUniqueId);
        
        if (!fromNode || !toNode) return;

        // Find and remove the link
        const linkIndex = this.links.findIndex(link => 
            (link.from === fromNode && link.to === toNode) ||
            (link.from === toNode && link.to === fromNode)
        );

        if (linkIndex !== -1) {
            const link = this.links[linkIndex];
            this.scene.remove(link.line);
            
            // Dispose resources
            link.line.geometry.dispose();
            if (link.line.material instanceof THREE.Material) {
                link.line.material.dispose();
            }
            
            this.links.splice(linkIndex, 1);
            console.log(`Link removed: ${fromUniqueId} <-> ${toUniqueId}`);
        }
    }

    renameNode(oldUniqueId: string, newUniqueId: string, newFilePath?: string): void {
        const node = this.nodes.get(oldUniqueId);
        if (!node) return;

        // Update node userData - keep display name unchanged unless explicitly provided
        node.userData.uniqueId = newUniqueId;
        if (newFilePath) {
            node.userData.filePath = newFilePath;
        }

        // Move node in the map
        this.nodes.delete(oldUniqueId);
        this.nodes.set(newUniqueId, node);

        // Update color pulse data
        const pulseData = this.colorPulseData.get(oldUniqueId);
        if (pulseData) {
            this.colorPulseData.delete(oldUniqueId);
            this.colorPulseData.set(newUniqueId, pulseData);
        }

        // Update file path
        this.nodeFilePaths.delete(oldUniqueId);
        if (newFilePath) {
            this.nodeFilePaths.set(newUniqueId, newFilePath);
        }

        // Update label
        this.removeLabelForNode(oldUniqueId);
        // New label will be created automatically in next update

        console.log(`Node renamed: ${oldUniqueId} -> ${newUniqueId}`);
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

        // Spawn particles in all links, shuffling them
        if (currentTime - this.lastSpawn > this.spawnRate && links.length > 0) {
            // Shuffle the links array
            const shuffledLinks = [...links].sort(() => Math.random() - 0.5);
            
            shuffledLinks.forEach((link, index) => {
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