import type { Service } from "@shared/types";

export class ServiceGraph {
  private services: Map<string, Service> = new Map();

  addService(service: Service): void {
    this.services.set(service.id, service);
  }

  getService(id: string): Service | undefined {
    return this.services.get(id);
  }

  getDependencies(serviceId: string): Service[] {
    const service = this.services.get(serviceId);
    if (!service) return [];
    return service.dependencies
      .map((dep) => this.services.get(dep))
      .filter((s): s is Service => s !== undefined);
  }

  getDownstreamImpact(serviceId: string): Service[] {
    const affected: Service[] = [];
    for (const service of this.services.values()) {
      if (service.dependencies.includes(serviceId)) {
        affected.push(service);
      }
    }
    return affected;
  }
}
