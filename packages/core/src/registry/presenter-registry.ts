import { PluginRegistryError } from '../errors/plugin-registry-error.js';

export interface Presenter {
  readonly name: string;
}

export class PresenterRegistry {
  private readonly presenters = new Map<string, Presenter>();

  register(presenter: Presenter): void {
    if (this.presenters.has(presenter.name)) {
      throw new PluginRegistryError({
        code: 'DUPLICATE_PLUGIN',
        message: `Presenter "${presenter.name}" is already registered`,
        pluginType: 'presenter',
        pluginName: presenter.name,
      });
    }
    this.presenters.set(presenter.name, presenter);
  }

  get(name: string): Presenter {
    const presenter = this.presenters.get(name);
    if (presenter === undefined) {
      throw new PluginRegistryError({
        code: 'PLUGIN_NOT_FOUND',
        message: `Presenter "${name}" is not registered`,
        pluginType: 'presenter',
        pluginName: name,
      });
    }
    return presenter;
  }
}
