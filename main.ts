import { App, MarkdownView, Plugin, PluginManifest, TFile } from 'obsidian';
import { SettingTab } from './src/settings';
import { Fragment as _Fragment, jsxs as _jsxs, jsx as _jsx } from 'react/jsx-runtime';
import { ComponentType } from 'react';
import { compileJsxIntoComponent, loadComponents } from './src/bundle';
import { EMERA_COMPONENT_PREFIX, EMERA_COMPONENTS_REGISTRY, EMERA_JS_LANG_NAME, EMERA_JSX_LANG_NAME } from './src/consts';
import './src/side-effects';
import { emeraEditorPlugin, registerCodemirrorMode } from './src/codemirror';
import { renderComponent } from './src/renderer';
import { eventBus } from './src/events';


interface PluginSettings {
    componentsFolder: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
    componentsFolder: 'Components'
}

type QueueElement =
    | { type: 'single', name: string, elementRef: WeakRef<HTMLElement>, file: TFile }
    | { type: 'tree', elementRef: WeakRef<HTMLElement>, file: TFile }

export default class EmeraPlugin extends Plugin {
    settings: PluginSettings;
    componentsRegistry: Record<string, ComponentType<any>> = {};
    registeredShorthandsProcessors: string[] = [];
    queue: QueueElement[] = [];
    isFilesLoaded = false;
    componentsLoaded: Promise<void>;
    private resolveComponentsLoaded: VoidFunction;

    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
        const { resolve, promise } = Promise.withResolvers<void>();
        this.componentsLoaded = promise;
        this.resolveComponentsLoaded = resolve;
    }

    async onload() {
        this.componentsRegistry = (window as any)[EMERA_COMPONENTS_REGISTRY];

        await this.loadSettings();
        this.addSettingTab(new SettingTab(this.app, this));

        // @ts-ignore
        window.emera = this;

        this.registerEditorExtension(emeraEditorPlugin(this));
        this.attachMarkdownProcessors();

        this.app.workspace.onLayoutReady(async () => {
            this.isFilesLoaded = true;

            const registry = await loadComponents(this);
            Object.assign(this.componentsRegistry, registry);
            this.resolveComponentsLoaded();
            eventBus.emit('onComponentsLoaded');
            Object.keys(this.componentsRegistry).forEach((name) => {
                this.attachShorthandNotationProcessor(name);
            });

            this.refreshEditors();
        });
    }

    attachShorthandNotationProcessor = (name: string) => {
        if (this.registeredShorthandsProcessors.includes(name)) {
            return;
        }
        registerCodemirrorMode(`${EMERA_COMPONENT_PREFIX}${name}`, 'markdown');
        this.registerMarkdownCodeBlockProcessor(`${EMERA_COMPONENT_PREFIX}${name}`, (src, container, ctx) => {
            const file = this.app.vault.getFileByPath(ctx.sourcePath)!;
            const component = this.componentsRegistry[name];
            const root = renderComponent({
                plugin: this,
                component,
                context: {
                    file,
                },
                container,
                children: src
            });

            eventBus.on('onComponentsReloaded', () => {
                renderComponent({
                    plugin: this,
                    component,
                    context: {
                        file,
                    },
                    container: root,
                    children: src
                });
            });
        });
        this.registeredShorthandsProcessors.push(name);
    }

    attachMarkdownProcessors = () => {
        this.registerMarkdownCodeBlockProcessor(EMERA_JSX_LANG_NAME, async (src, container, ctx) => {
            await this.componentsLoaded;
            const file = this.app.vault.getFileByPath(ctx.sourcePath)!;
            if (!src) {
                // TODO: render error or at least some note for user
                return;
            }
            const component = await compileJsxIntoComponent(src);
            const root = renderComponent({
                plugin: this,
                component,
                context: {
                    file,
                },
                container,
            });
            eventBus.on('onComponentsReloaded', () => {
                console.log('Components reloaded, updating JSX block');
                renderComponent({
                    plugin: this,
                    component,
                    context: {
                        file,
                    },
                    container: root,
                });
            });
        });

        this.registerMarkdownCodeBlockProcessor(EMERA_JS_LANG_NAME, async (src, container, ctx) => {
            console.log('Processing code block', src, ctx);
            // TODO: we need to know how many code blocks there is on page an which one of them is current one.
            // This doesn't seem possible with `registerMarkdownCodeBlockProcessor`, but we should be able to 
            // make our own CodeMirror extension which will replace emjs blocks

            // Algo:
            // Transpile code (no need for bundling)
            // Ensure it's executed in same order as defined on page
            // Store results of execution in special `scope` object (one per page)
            // We don't really to what script is evaluated, as we won't show its results directly
            // Render generic 'Emera code' in place of code block
            // Maybe allow user exporting string variable `emeraBlockName` which will be used in placeholder for easier navigation
            container.innerText = '[Emera code]';
        });
    }

    refreshEditors = () => {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view && leaf.view instanceof MarkdownView) {
                leaf.view.editor.refresh();
            }
        });

    }

    refreshComponents = async () => {
        const registry = await loadComponents(this);
        Object.assign(this.componentsRegistry, registry);
        Object.keys(this.componentsRegistry).forEach((name) => {
            this.attachShorthandNotationProcessor(name);
        });

        console.log('Emitting onComponentsReloaded');
        eventBus.emit('onComponentsReloaded');
        this.refreshEditors();
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

