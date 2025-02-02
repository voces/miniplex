import { Query } from "."
import { Archetype } from "./Archetype"
import { commandQueue } from "./util/commandQueue"
import { idGenerator } from "./util/idGenerator"
import normalizeArchetype from "./util/normalizeArchetype"

/**
 * A base interface for entities, which are just normal JavaScript objects with
 * any number of properties, each of which represents a single component. When
 * using hmecs, it is recommended to create your own type representing your
 * game's entities, and pass that to `createWorld` for full typing support.
 */
export interface IEntity {
  id?: number
}

/**
 * For situations where no entity type argument is passed to createWorld, we'll
 * default to an untyped entity type that can hold any component.
 */
export type UntypedEntity = { [components: string]: ComponentData } & IEntity

/**
 * Component names are just strings/object property names.
 */
export type ComponentName<T extends IEntity> = keyof T

/**
 * The data of a component can be literally anything. Good times!
 */
export type ComponentData = any

/**
 * A tag is just an "empty" component. For convenience and nicer type support, we're
 * providing a Tag type and constant, both of which are simply equal to `true`.
 */
export const Tag = true
export type Tag = true

export class World<T extends IEntity = UntypedEntity> {
  /** An array holding all entities known to this world. */
  public entities = new Array<T>()

  /** An ID generator we use for assigning IDs to newly added entities. */
  private nextId = idGenerator(1)

  /** A list of known archetypes. */
  private archetypes: Map<string, Archetype<T>> = new Map()

  public archetype<TQuery extends Query<T>>(...query: TQuery): Archetype<T, TQuery> {
    const normalizedQuery = normalizeArchetype(query)

    /* We may already have an archetype representing the same query */
    const stringifiedQuery = JSON.stringify(normalizedQuery)
    if (this.archetypes.has(stringifiedQuery))
      return this.archetypes.get(stringifiedQuery) as Archetype<T, TQuery>

    /* Once we reach this point, we need to create a new archetype. */
    const archetype = new Archetype<T>(normalizedQuery)
    this.archetypes.set(stringifiedQuery, archetype)
    for (const entity of this.entities) archetype.indexEntity(entity)

    return archetype as Archetype<T, TQuery>
  }

  private indexEntity(entity: T) {
    if (this.entities.includes(entity))
      for (const archetype of this.archetypes.values()) archetype.indexEntity(entity)
  }

  /* MUTATION FUNCTIONS */

  public createEntity = (entity: T = {} as T) => {
    /* If there already is an ID, raise an error. */
    if ("id" in entity) throw "Attempted to add an entity that aleady had an 'id' component."

    /* Assign an ID */
    entity.id = this.nextId()

    /* Store the entity... */
    this.entities.push(entity)

    /* ...and add it to relevant indices. */
    this.indexEntity(entity)

    return entity
  }

  public destroyEntity = (entity: T) => {
    const pos = this.entities.indexOf(entity, 0)

    /* Sanity check */
    if (pos < 0) return

    /* Remove it from our global list of entities */
    this.entities.splice(pos, 1)

    /* Remove entity from all archetypes */
    for (const archetype of this.archetypes.values()) {
      archetype.removeEntity(entity)
    }

    /* Remove its id component */
    delete entity.id
  }

  public addComponent = <U extends ComponentName<T>>(entity: T, name: U, data: T[U]) => {
    if (name in entity) {
      throw `Tried to add component "${name}" to an entity that already has it.`
    }

    /* TODO: checking entity ownership like this is likely to slow us down quite a lot, so eventually we'll want something smarter here. */
    if (!this.entities.includes(entity)) {
      throw `Tried to add component "${name}" to an entity that is not managed by this world.`
    }

    /* Add the component */
    entity[name] = data

    /* Trigger a reindexing of the entity */
    this.indexEntity(entity)
  }

  public removeComponent = (entity: T, ...components: ComponentName<T>[]) => {
    /* TODO: checking entity ownership like this is likely to slow us down quite a lot, so eventually we'll want something smarter here. */
    if (!this.entities.includes(entity)) {
      throw `Tried to remove ${components} from an entity that is not managed by this world.`
    }

    for (const name of components) {
      if (!(name in entity)) {
        throw `Tried to remove component "${name} from an entity that doesn't have it.`
      }

      delete entity[name]
    }

    this.indexEntity(entity)
  }

  /* QUEUED MUTATION FUNCTIONS */

  /**
   * A queue of commands to run.
   */
  private queuedCommands = commandQueue()

  public queue = {
    createEntity: (entity: T) => {
      this.queuedCommands.add(() => this.createEntity(entity))
      return entity
    },

    destroyEntity: (entity: T) => {
      this.queuedCommands.add(() => this.destroyEntity(entity))
    },

    addComponent: <U extends ComponentName<T>>(entity: T, name: U, data: T[U]) => {
      this.queuedCommands.add(() => this.addComponent(entity, name, data))
    },

    removeComponent: (entity: T, ...names: ComponentName<T>[]) => {
      this.queuedCommands.add(() => this.removeComponent(entity, ...names))
    },

    flush: () => {
      this.queuedCommands.flush()
    }
  }

  /**
   * Clear the entire world by discarding all entities and indices.
   */
  public clear() {
    /* Remove all entities */
    this.entities.length = 0

    /* Remove all archetype indices */
    this.archetypes.clear()

    /* Clear queue */
    this.queuedCommands.clear()
  }
}
