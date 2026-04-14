/**
 * Container setup utilities for benchmark commands
 * @module cli/commands/bench/container-setup
 */

import type { ContainerConfig } from "../../../src/container/types.ts";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import {
  type BcContainerProvider,
  ContainerProviderRegistry,
} from "../../../src/container/mod.ts";
import { log } from "../../helpers/mod.ts";

/**
 * Container configuration from app config
 */
export interface ContainerAppConfig {
  name?: string;
  provider?: string;
  bcVersion?: string;
  memoryLimit?: string;
  credentials?: {
    username?: string;
    password?: string;
  };
}

/**
 * Result of container setup
 */
export interface ContainerSetupResult {
  containerProvider: ContainerProvider;
  containerName: string;
  /** True if container was already running (should not be cleaned up) */
  wasExisting: boolean;
}

/**
 * Setup container for benchmark execution
 * Handles provider detection, health checks, and container creation
 */
export async function setupContainer(
  containerProviderName: string | undefined,
  containerConfig: ContainerAppConfig,
  options?: { noCompilerCache?: boolean },
): Promise<ContainerSetupResult> {
  const containerName = containerConfig.name || "centralgauge-benchmark";

  // Resolve container provider
  const containerProvider =
    !containerProviderName || containerProviderName === "auto"
      ? (containerConfig.provider
        ? ContainerProviderRegistry.create(containerConfig.provider)
        : await ContainerProviderRegistry.getDefault())
      : ContainerProviderRegistry.create(containerProviderName);

  // Pass credentials to provider if available
  if (containerConfig.credentials && "setCredentials" in containerProvider) {
    (containerProvider as BcContainerProvider)
      .setCredentials(containerName, {
        username: containerConfig.credentials.username || "admin",
        password: containerConfig.credentials.password || "admin",
      });
  }

  // Configure compiler cache
  if (
    options?.noCompilerCache &&
    "setCompilerCacheEnabled" in containerProvider
  ) {
    (containerProvider as BcContainerProvider).setCompilerCacheEnabled(false);
  }

  // Check if container already exists and is healthy
  let containerReady = false;
  try {
    containerReady = await containerProvider.isHealthy(containerName);
    if (!containerReady) {
      // Container exists but might be stopped - try to start it
      try {
        const status = await containerProvider.status(containerName);
        if (!status.isRunning) {
          log.container(
            `Container ${containerName} exists but is stopped, starting...`,
          );
          await containerProvider.start(containerName);
          // Wait a moment for container to be ready
          await new Promise((resolve) => setTimeout(resolve, 5000));
          containerReady = await containerProvider.isHealthy(containerName);
        }
      } catch {
        // Status check failed, container might not exist
      }
    }
  } catch {
    // Container doesn't exist yet
  }

  if (containerReady) {
    log.container(`Using existing: ${containerName}`);
  } else {
    log.container("Setting up...");
    const setupConfig: ContainerConfig = {
      name: containerName,
      bcVersion: containerConfig.bcVersion || "24.0",
      memoryLimit: containerConfig.memoryLimit || "8G",
      acceptEula: true,
      includeAL: true,
      includeTestToolkit: true,
    };
    if (
      containerConfig.credentials?.username &&
      containerConfig.credentials?.password
    ) {
      setupConfig.credentials = {
        username: containerConfig.credentials.username,
        password: containerConfig.credentials.password,
      };
    }
    await containerProvider.setup(setupConfig);
  }

  return {
    containerProvider,
    containerName,
    wasExisting: containerReady,
  };
}

/**
 * Result of multi-container setup
 */
export interface MultiContainerSetupResult {
  containerProvider: ContainerProvider;
  containerNames: string[];
}

/**
 * Setup multiple containers for multi-container benchmark execution.
 * All containers must be pre-existing and healthy.
 */
export async function setupContainers(
  containerNames: string[],
  containerProviderName: string | undefined,
  containerConfig: ContainerAppConfig,
  options?: { noCompilerCache?: boolean },
): Promise<MultiContainerSetupResult> {
  // Resolve provider once (singleton per type)
  const containerProvider =
    !containerProviderName || containerProviderName === "auto"
      ? (containerConfig.provider
        ? ContainerProviderRegistry.create(containerConfig.provider)
        : await ContainerProviderRegistry.getDefault())
      : ContainerProviderRegistry.create(containerProviderName);

  // Configure compiler cache
  if (
    options?.noCompilerCache &&
    "setCompilerCacheEnabled" in containerProvider
  ) {
    (containerProvider as BcContainerProvider).setCompilerCacheEnabled(false);
  }

  for (const name of containerNames) {
    // Set credentials for each container
    if (containerConfig.credentials && "setCredentials" in containerProvider) {
      (containerProvider as BcContainerProvider)
        .setCredentials(name, {
          username: containerConfig.credentials.username || "admin",
          password: containerConfig.credentials.password || "admin",
        });
    }

    // Health check each container
    let healthy = false;
    try {
      healthy = await containerProvider.isHealthy(name);
    } catch {
      // container doesn't exist
    }

    if (healthy) {
      log.container(`Using existing: ${name}`);
    } else {
      throw new Error(
        `Container "${name}" is not running. Multi-container mode requires all containers to be pre-existing and healthy.`,
      );
    }
  }

  return { containerProvider, containerNames };
}

/**
 * Cleanup container after benchmark
 */
export async function cleanupContainer(
  containerProvider: ContainerProvider,
  containerName: string,
  wasExisting: boolean,
): Promise<void> {
  // Only cleanup container if we created it
  if (!wasExisting) {
    log.container("Cleaning up...");
    await containerProvider.stop(containerName);
    await containerProvider.remove(containerName);
  }

  // Cleanup compiler folders to free disk space
  if (containerProvider.cleanupCompilerFolders) {
    await containerProvider.cleanupCompilerFolders();
  }
}
