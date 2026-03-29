import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pagination,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  type Selection,
} from "@heroui/react";
import {
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShieldX,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { localizeApiErrorDisplay } from "@/api/errorI18n";
import {
  modelsApi,
  type ListModelsResponse,
  type ModelAvailabilityStatus,
  type ModelSchema,
} from "@/api/models";
import {
  DockedPageIntro,
  PageContent,
} from "@/components/layout/page-archetypes";
import { notify } from "@/lib/notification";
import { cn } from "@/lib/utils";

type AvailabilityFilter = "all" | ModelAvailabilityStatus;

const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const EMPTY_MODELS: ModelSchema[] = [];

function normalizeSelection(selection: Selection) {
  if (selection === "all") {
    return "";
  }

  const [first] = Array.from(selection);
  return first === undefined ? "" : String(first);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function formatUsdPerMillion(
  value: number | null | undefined,
  fallback: string,
) {
  if (value == null) {
    return fallback;
  }

  return `$${(value / 1_000_000).toFixed(4)}`;
}

function formatTokenCount(value: number | null | undefined, fallback: string) {
  if (value == null || value <= 0) {
    return fallback;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

function getAvailabilityColor(status: ModelAvailabilityStatus) {
  switch (status) {
    case "available":
      return "success" as const;
    case "unavailable":
      return "danger" as const;
    case "unknown":
    default:
      return "default" as const;
  }
}

function getAvailabilityLabel(
  status: ModelAvailabilityStatus,
  t: ReturnType<typeof useTranslation>["t"],
) {
  switch (status) {
    case "available":
      return t("models.availability.available");
    case "unavailable":
      return t("models.availability.unavailable");
    case "unknown":
    default:
      return t("models.availability.unknown");
  }
}

function matchModelSearch(model: ModelSchema, keyword: string) {
  const haystack = [
    model.id,
    model.owned_by,
    model.official?.title,
    model.official?.description,
    model.effective_pricing.source,
    model.availability_error,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(keyword);
}

function resolveNoValueLabel(t: ReturnType<typeof useTranslation>["t"]) {
  return t("models.antigravity.notAvailable");
}

function buildCatalogAttention(
  payload: ListModelsResponse["meta"] | undefined,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!payload) {
    return null;
  }

  if (payload.catalog_sync_required) {
    return t("models.antigravity.catalogAttentionSyncRequired");
  }

  if (payload.catalog_last_error) {
    return t("models.antigravity.catalogAttentionRetry");
  }

  if (payload.probe_cache_stale) {
    return t("models.antigravity.catalogAttentionCacheStale");
  }

  return null;
}

function describeAvailabilityOutcome(
  model: ModelSchema,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (model.availability_status === "available") {
    return t("models.antigravity.availabilityOutcome.available");
  }

  if (
    model.availability_status === "unavailable" &&
    model.availability_http_status != null
  ) {
    return t("models.antigravity.availabilityOutcome.unavailableWithStatus", {
      status: model.availability_http_status,
    });
  }

  if (model.availability_status === "unavailable") {
    return t("models.antigravity.availabilityOutcome.unavailable");
  }

  return t("models.antigravity.availabilityOutcome.unknown");
}

function buildModelsSummary(
  payload: ListModelsResponse | undefined,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const models = payload?.data ?? [];
  const providers = new Set(
    models.map((model) => model.owned_by).filter(Boolean),
  );
  const available = models.filter(
    (model) => model.availability_status === "available",
  ).length;
  const unavailable = models.filter(
    (model) => model.availability_status === "unavailable",
  ).length;

  return [
    {
      title: t("models.antigravity.metrics.total"),
      value: models.length,
      description: t("models.antigravity.metrics.totalDesc"),
      icon: Database,
      toneClassName: "bg-primary/10 text-primary",
    },
    {
      title: t("models.antigravity.metrics.available"),
      value: available,
      description: t("models.antigravity.metrics.availableDesc"),
      icon: ShieldCheck,
      toneClassName: "bg-success/10 text-success",
    },
    {
      title: t("models.antigravity.metrics.unavailable"),
      value: unavailable,
      description: t("models.antigravity.metrics.unavailableDesc"),
      icon: ShieldX,
      toneClassName: "bg-danger/10 text-danger",
    },
    {
      title: t("models.antigravity.metrics.providers"),
      value: providers.size,
      description: t("models.antigravity.metrics.providersDesc"),
      icon: Sparkles,
      toneClassName: "bg-secondary/10 text-secondary",
    },
  ];
}

export default function Models() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchValue, setSearchValue] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const {
    data: modelsPayload,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["models"],
    queryFn: modelsApi.listModels,
    refetchInterval: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: modelsApi.syncOpenAiCatalog,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      notify({
        variant: "success",
        title: t("models.actions.syncOpenAiCatalog"),
        description: t("models.notice.openAiCatalogSynced", {
          count: result.created_or_updated,
        }),
      });
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      const fallback = t("models.errors.openAiCatalogSyncFailed");
      notify({
        variant: "error",
        title: t("models.actions.syncOpenAiCatalog"),
        description: localizeApiErrorDisplay(t, error, fallback).label,
      });
    },
  });

  const probeMutation = useMutation({
    mutationFn: () => modelsApi.probeModels({ force: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      notify({
        variant: "success",
        title: t("models.actions.probeAvailability"),
        description: t("models.notice.probeCompleted"),
      });
    },
    onError: (error) => {
      const fallback = t("models.errors.probeFailed");
      notify({
        variant: "error",
        title: t("models.actions.probeAvailability"),
        description: localizeApiErrorDisplay(t, error, fallback).label,
      });
    },
  });

  const models = useMemo(
    () => modelsPayload?.data ?? EMPTY_MODELS,
    [modelsPayload?.data],
  );
  const meta = modelsPayload?.meta;
  const noValueLabel = resolveNoValueLabel(t);
  const summaryCards = useMemo(
    () => buildModelsSummary(modelsPayload, t),
    [modelsPayload, t],
  );
  const catalogAttention = useMemo(
    () => buildCatalogAttention(meta, t),
    [meta, t],
  );

  const providerOptions = useMemo(
    () =>
      [...new Set(models.map((model) => model.owned_by).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [models],
  );

  const filteredModels = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();

    return models.filter((model) => {
      if (providerFilter !== "all" && model.owned_by !== providerFilter) {
        return false;
      }
      if (
        availabilityFilter !== "all" &&
        model.availability_status !== availabilityFilter
      ) {
        return false;
      }
      if (keyword && !matchModelSearch(model, keyword)) {
        return false;
      }
      return true;
    });
  }, [availabilityFilter, models, providerFilter, searchValue]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredModels.length / rowsPerPage),
  );
  const resolvedPage = Math.min(currentPage, totalPages);
  const paginatedModels = useMemo(() => {
    const start = (resolvedPage - 1) * rowsPerPage;
    return filteredModels.slice(start, start + rowsPerPage);
  }, [filteredModels, resolvedPage, rowsPerPage]);
  const visibleRangeStart =
    filteredModels.length === 0 ? 0 : (resolvedPage - 1) * rowsPerPage + 1;
  const visibleRangeEnd =
    filteredModels.length === 0
      ? 0
      : Math.min(filteredModels.length, resolvedPage * rowsPerPage);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  return (
    <PageContent className="space-y-6">
      <DockedPageIntro
        archetype="workspace"
        title={t("models.title")}
        description={t("models.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Dropdown>
              <DropdownTrigger>
                <Button
                  color="primary"
                  endContent={
                    probeMutation.isPending ||
                    syncMutation.isPending ? undefined : (
                      <ChevronDown className="h-4 w-4" />
                    )
                  }
                  isDisabled={probeMutation.isPending || syncMutation.isPending}
                  isLoading={probeMutation.isPending || syncMutation.isPending}
                  startContent={<Sparkles className="h-4 w-4" />}
                  variant="flat"
                >
                  {t("models.antigravity.maintenance")}
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={t("models.antigravity.maintenance")}
                disabledKeys={
                  probeMutation.isPending || syncMutation.isPending
                    ? ["probe", "sync"]
                    : []
                }
                onAction={(key) => {
                  if (String(key) === "probe") {
                    probeMutation.mutate();
                    return;
                  }
                  if (String(key) === "sync") {
                    syncMutation.mutate();
                  }
                }}
              >
                <DropdownItem
                  key="probe"
                  description={t(
                    "models.antigravity.maintenanceProbeDescription",
                  )}
                  startContent={<Sparkles className="h-4 w-4" />}
                >
                  {t("models.actions.probeAvailability")}
                </DropdownItem>
                <DropdownItem
                  key="sync"
                  description={t(
                    "models.antigravity.maintenanceSyncDescription",
                  )}
                  startContent={<RefreshCcw className="h-4 w-4" />}
                >
                  {t("models.actions.syncOpenAiCatalog")}
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
            <Button
              isLoading={isFetching}
              startContent={
                isFetching ? undefined : <RefreshCcw className="h-4 w-4" />
              }
              variant="light"
              onPress={() => {
                void refetch();
              }}
            >
              {t("common.refresh")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t("models.antigravity.summaryTitle")}
              </h2>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 px-5 pb-5 pt-1 sm:grid-cols-2">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="rounded-large border border-default-200 bg-content2/55 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-large",
                        card.toneClassName,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                    {card.title}
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                    {card.value}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-default-500">
                    {card.description}
                  </p>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t("models.antigravity.catalogTitle")}
              </h2>
            </div>
          </CardHeader>
          <CardBody className="gap-4 px-5 pb-5 pt-1">
            <div className="flex flex-wrap gap-2">
              <Chip
                color={meta?.probe_cache_stale ? "warning" : "success"}
                size="sm"
                variant="flat"
              >
                {meta?.probe_cache_stale
                  ? t("models.antigravity.cacheStale")
                  : t("models.antigravity.cacheFresh")}
              </Chip>
              <Chip
                color={meta?.catalog_sync_required ? "warning" : "primary"}
                size="sm"
                variant="flat"
              >
                {meta?.catalog_sync_required
                  ? t("models.antigravity.catalogNeedsSync")
                  : t("models.antigravity.catalogReady")}
              </Chip>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-large border border-default-200 bg-content2/55 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                  {t("models.antigravity.cacheUpdatedAt")}
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {formatDateTime(meta?.probe_cache_updated_at)}
                </div>
              </div>
              <div className="rounded-large border border-default-200 bg-content2/55 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                  {t("models.antigravity.probeSource")}
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {meta?.probe_source_account_label ??
                    t("models.probeSourceUnknown")}
                </div>
              </div>
              <div className="rounded-large border border-default-200 bg-content2/55 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                  {t("models.antigravity.catalogSyncedAt")}
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {formatDateTime(meta?.catalog_synced_at)}
                </div>
              </div>
              <div className="rounded-large border border-default-200 bg-content2/55 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                  {t("models.antigravity.cacheTtl")}
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">
                  {t("models.antigravity.cacheTtlHours", {
                    hours: Math.round((meta?.probe_cache_ttl_sec ?? 0) / 3600),
                  })}
                </div>
              </div>
            </div>
            {catalogAttention ? (
              <div className="rounded-large border border-warning-200 bg-warning-50/80 px-4 py-3 text-sm leading-6 text-warning-700 dark:bg-warning/10 dark:text-warning-300">
                <div className="font-semibold">
                  {t("models.antigravity.catalogAttentionTitle")}
                </div>
                <div className="mt-1">{catalogAttention}</div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card className="border-small border-default-200 bg-content1 shadow-small">
        <CardHeader className="flex flex-col items-start gap-4 px-5 pb-3 pt-5">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
              {t("models.antigravity.directoryTitle")}
            </h2>
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Input
                aria-label={t("models.actions.search")}
                placeholder={t("models.actions.search")}
                size="sm"
                startContent={<Search className="h-4 w-4 text-default-400" />}
                value={searchValue}
                onValueChange={(value) => {
                  setCurrentPage(1);
                  setSearchValue(value);
                }}
              />

              <Select
                aria-label={t("models.filters.providerLabel")}
                items={[
                  { key: "all", label: t("models.filters.allProviders") },
                  ...providerOptions.map((provider) => ({
                    key: provider,
                    label: provider,
                  })),
                ]}
                selectedKeys={[providerFilter]}
                size="sm"
                onSelectionChange={(selection) => {
                  const nextValue = normalizeSelection(selection);
                  if (!nextValue) {
                    return;
                  }
                  setCurrentPage(1);
                  setProviderFilter(nextValue);
                }}
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>

              <Select
                aria-label={t("models.filters.availabilityLabel")}
                selectedKeys={[availabilityFilter]}
                size="sm"
                onSelectionChange={(selection) => {
                  const nextValue = normalizeSelection(selection);
                  if (!nextValue) {
                    return;
                  }
                  setCurrentPage(1);
                  setAvailabilityFilter(nextValue as AvailabilityFilter);
                }}
              >
                <SelectItem key="all">
                  {t("models.filters.allAvailability")}
                </SelectItem>
                <SelectItem key="available">
                  {t("models.availability.available")}
                </SelectItem>
                <SelectItem key="unavailable">
                  {t("models.availability.unavailable")}
                </SelectItem>
                <SelectItem key="unknown">
                  {t("models.availability.unknown")}
                </SelectItem>
              </Select>
            </div>

            <div className="flex items-center gap-2 text-xs text-default-500">
              <span>{t("common.table.rowsPerPage")}</span>
              <Select
                aria-label={t("common.table.rowsPerPage")}
                className="w-[106px]"
                selectedKeys={[String(rowsPerPage)]}
                size="sm"
                onSelectionChange={(selection) => {
                  const nextValue = normalizeSelection(selection);
                  if (!nextValue) {
                    return;
                  }
                  setCurrentPage(1);
                  setRowsPerPage(Number(nextValue));
                }}
              >
                {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={String(size)}>{size}</SelectItem>
                ))}
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardBody className="gap-4 px-5 pb-5 pt-0">
          <Table
            isHeaderSticky
            aria-label={t("models.title")}
            classNames={{
              base: "min-h-[30rem]",
              wrapper: "bg-transparent px-0 py-0 shadow-none",
              th: "bg-default-100/60 text-xs font-semibold uppercase tracking-[0.12em] text-default-500",
              td: "align-top py-4 text-sm text-foreground",
              tr: "data-[hover=true]:bg-content2/35 transition-colors",
              emptyWrapper: "h-56",
            }}
          >
            <TableHeader>
              <TableColumn>{t("models.columns.id")}</TableColumn>
              <TableColumn>{t("models.columns.provider")}</TableColumn>
              <TableColumn>{t("models.columns.availability")}</TableColumn>
              <TableColumn>{t("models.columns.inputPrice")}</TableColumn>
              <TableColumn>{t("models.columns.context")}</TableColumn>
              <TableColumn>{t("models.columns.actions")}</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                <div className="flex flex-col items-center gap-3 py-12 text-default-500">
                  <Database className="h-10 w-10 opacity-35" />
                  <div className="text-sm font-medium">{t("models.empty")}</div>
                </div>
              }
              isLoading={isLoading}
              items={paginatedModels}
              loadingContent={<Spinner label={t("common.loading")} />}
            >
              {(model) => (
                <TableRow key={model.id}>
                  <TableCell>
                    <div className="min-w-[260px] space-y-1">
                      <div className="font-medium text-foreground">
                        {model.official?.title || model.id}
                      </div>
                      <div className="font-mono text-xs leading-5 text-default-500">
                        {model.id}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-[180px] space-y-2">
                      <Chip size="sm" variant="flat">
                        {model.owned_by}
                      </Chip>
                      <div className="text-xs leading-5 text-default-500">
                        {model.effective_pricing.source}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-[190px] space-y-2">
                      <Chip
                        color={getAvailabilityColor(model.availability_status)}
                        size="sm"
                        variant="flat"
                      >
                        {getAvailabilityLabel(model.availability_status, t)}
                      </Chip>
                      <div className="text-xs leading-5 text-default-500">
                        {t("models.columns.checkedAt")}:{" "}
                        {formatDateTime(model.availability_checked_at)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-[190px] space-y-1 text-xs leading-5 text-default-500">
                      <div>
                        {t("models.columns.inputPrice")}:{" "}
                        {formatUsdPerMillion(
                          model.effective_pricing.input_price_microcredits,
                          noValueLabel,
                        )}
                      </div>
                      <div>
                        {t("models.columns.cachedInputPrice")}:{" "}
                        {formatUsdPerMillion(
                          model.effective_pricing
                            .cached_input_price_microcredits,
                          noValueLabel,
                        )}
                      </div>
                      <div>
                        {t("models.columns.outputPrice")}:{" "}
                        {formatUsdPerMillion(
                          model.effective_pricing.output_price_microcredits,
                          noValueLabel,
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-[180px] space-y-1 text-xs leading-5 text-default-500">
                      <div>
                        {t("models.detail.contextWindow")}:{" "}
                        {formatTokenCount(
                          model.official?.context_window_tokens,
                          noValueLabel,
                        )}
                      </div>
                      <div>
                        {t("models.detail.maxOutputTokens")}:{" "}
                        {formatTokenCount(
                          model.official?.max_output_tokens,
                          noValueLabel,
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[180px] flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => setSelectedModelId(model.id)}
                      >
                        {t("models.actions.openDetails")}
                      </Button>
                      <Button
                        size="sm"
                        startContent={<Copy className="h-4 w-4" />}
                        variant="light"
                        onPress={async () => {
                          try {
                            await navigator.clipboard.writeText(model.id);
                            notify({
                              variant: "success",
                              title: t("models.actions.copyModelId"),
                              description: t(
                                "models.antigravity.copyModelIdSuccess",
                                {
                                  modelId: model.id,
                                },
                              ),
                            });
                          } catch (error) {
                            const fallback = t("models.antigravity.copyModelIdFailed");
                            notify({
                              variant: "error",
                              title: t("models.actions.copyModelId"),
                              description: localizeApiErrorDisplay(
                                t,
                                error,
                                fallback,
                              ).label,
                            });
                          }
                        }}
                      >
                        {t("models.actions.copyModelId")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-3 border-t border-default-200 pt-3 text-xs text-default-500 sm:flex-row sm:items-center sm:justify-between">
            <div className="tabular-nums">
              {t("common.table.range", {
                start: visibleRangeStart,
                end: visibleRangeEnd,
                total: filteredModels.length,
              })}
            </div>
            <Pagination
              color="primary"
              isCompact
              page={resolvedPage}
              total={totalPages}
              onChange={setCurrentPage}
            />
          </div>
        </CardBody>
      </Card>

      <Modal
        backdrop="blur"
        classNames={{
          base: "border-small border-default-200 bg-content1 shadow-large",
          body: "pt-0",
          backdrop: "bg-black/52 backdrop-blur-[2px]",
          wrapper: "px-2 py-2 sm:px-6 sm:py-6",
        }}
        isOpen={Boolean(selectedModelId)}
        placement="center"
        scrollBehavior="inside"
        size="5xl"
        onOpenChange={(open) => {
          if (!open) {
            setSelectedModelId(null);
          }
        }}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-2">
                <div className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                  {selectedModel?.official?.title ||
                    selectedModel?.id ||
                    t("models.detail.title")}
                </div>
                <div className="font-mono text-xs text-default-500">
                  {selectedModel?.id ?? "-"}
                </div>
                <div className="text-sm leading-6 text-default-600">
                  {selectedModel?.official?.description ||
                    t("models.antigravity.noDescription")}
                </div>
              </ModalHeader>
              <ModalBody className="pb-5">
                {selectedModel ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 lg:grid-cols-3">
                      <Card className="border-small border-default-200 bg-content2/55 shadow-none">
                        <CardHeader className="px-4 pb-2 pt-4">
                          <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                            {t("models.antigravity.sections.operational")}
                          </h3>
                        </CardHeader>
                        <CardBody className="gap-3 px-4 pb-4 pt-0 text-sm text-default-600">
                          <div>
                            {t("models.columns.provider")}:{" "}
                            {selectedModel.owned_by}
                          </div>
                          <div>
                            {t("models.columns.availability")}:{" "}
                            {getAvailabilityLabel(
                              selectedModel.availability_status,
                              t,
                            )}
                          </div>
                          <div>
                            {t("models.columns.checkedAt")}:{" "}
                            {formatDateTime(
                              selectedModel.availability_checked_at,
                            )}
                          </div>
                          <div>
                            {t("models.detail.httpStatus")}:{" "}
                            {selectedModel.availability_http_status ??
                              noValueLabel}
                          </div>
                          <div>
                            {t("models.antigravity.effectivePricingSource")}:{" "}
                            {selectedModel.effective_pricing.source}
                          </div>
                          <div>
                            {t("models.columns.syncedAt")}:{" "}
                            {formatDateTime(selectedModel.official?.synced_at)}
                          </div>
                        </CardBody>
                      </Card>

                      <Card className="border-small border-default-200 bg-content2/55 shadow-none">
                        <CardHeader className="px-4 pb-2 pt-4">
                          <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                            {t("models.antigravity.sections.pricing")}
                          </h3>
                        </CardHeader>
                        <CardBody className="gap-3 px-4 pb-4 pt-0 text-sm text-default-600">
                          <div>
                            {t("models.columns.inputPrice")}:{" "}
                            {formatUsdPerMillion(
                              selectedModel.effective_pricing
                                .input_price_microcredits,
                              noValueLabel,
                            )}
                          </div>
                          <div>
                            {t("models.columns.cachedInputPrice")}:{" "}
                            {formatUsdPerMillion(
                              selectedModel.effective_pricing
                                .cached_input_price_microcredits,
                              noValueLabel,
                            )}
                          </div>
                          <div>
                            {t("models.columns.outputPrice")}:{" "}
                            {formatUsdPerMillion(
                              selectedModel.effective_pricing
                                .output_price_microcredits,
                              noValueLabel,
                            )}
                          </div>
                          <Divider />
                          <div>
                            {t("models.pricing.officialBase")}:{" "}
                            {formatUsdPerMillion(
                              selectedModel.official?.input_price_microcredits,
                              noValueLabel,
                            )}
                          </div>
                          <div>
                            {t("models.pricing.manualOverride")}:{" "}
                            {selectedModel.override_pricing
                              ? t("common.yes")
                              : t("common.no")}
                          </div>
                        </CardBody>
                      </Card>

                      <Card className="border-small border-default-200 bg-content2/55 shadow-none">
                        <CardHeader className="px-4 pb-2 pt-4">
                          <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                            {t("models.detail.capabilitiesTitle")}
                          </h3>
                        </CardHeader>
                        <CardBody className="gap-3 px-4 pb-4 pt-0 text-sm text-default-600">
                          <div>
                            {t("models.detail.contextWindow")}:{" "}
                            {formatTokenCount(
                              selectedModel.official?.context_window_tokens,
                              noValueLabel,
                            )}
                          </div>
                          <div>
                            {t("models.detail.maxOutputTokens")}:{" "}
                            {formatTokenCount(
                              selectedModel.official?.max_output_tokens,
                              noValueLabel,
                            )}
                          </div>
                          <div>
                            {t("models.detail.knowledgeCutoff")}:{" "}
                            {selectedModel.official?.knowledge_cutoff ??
                              noValueLabel}
                          </div>
                          <div>
                            {t("models.detail.reasoningTokenSupport")}:{" "}
                            {selectedModel.official?.reasoning_token_support
                              ? t("common.yes")
                              : t("common.no")}
                          </div>
                        </CardBody>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card className="border-small border-default-200 bg-content1 shadow-none">
                        <CardHeader className="px-4 pb-2 pt-4">
                          <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                            {t("models.detail.capabilitiesTitle")}
                          </h3>
                        </CardHeader>
                        <CardBody className="gap-4 px-4 pb-4 pt-0">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                              {t("models.detail.inputModalities")}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedModel.official?.input_modalities
                                ?.length ? (
                                selectedModel.official.input_modalities.map(
                                  (item) => (
                                    <Chip key={item} size="sm" variant="flat">
                                      {item}
                                    </Chip>
                                  ),
                                )
                              ) : (
                                <span className="text-sm text-default-600">
                                  {noValueLabel}
                                </span>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                              {t("models.detail.outputModalities")}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedModel.official?.output_modalities
                                ?.length ? (
                                selectedModel.official.output_modalities.map(
                                  (item) => (
                                    <Chip key={item} size="sm" variant="flat">
                                      {item}
                                    </Chip>
                                  ),
                                )
                              ) : (
                                <span className="text-sm text-default-600">
                                  {noValueLabel}
                                </span>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                              {t("models.detail.endpoints")}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedModel.official?.endpoints?.length ? (
                                selectedModel.official.endpoints.map((item) => (
                                  <Chip key={item} size="sm" variant="flat">
                                    {item}
                                  </Chip>
                                ))
                              ) : (
                                <span className="text-sm text-default-600">
                                  {noValueLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        </CardBody>
                      </Card>

                      <Card className="border-small border-default-200 bg-content1 shadow-none">
                        <CardHeader className="px-4 pb-2 pt-4">
                          <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                            {t("models.detail.officialTitle")}
                          </h3>
                        </CardHeader>
                        <CardBody className="gap-3 px-4 pb-4 pt-0 text-sm text-default-600">
                          <div>
                            {t("models.antigravity.officialPageStatus")}:{" "}
                            {selectedModel.official?.source_url
                              ? t("models.antigravity.officialPageReady")
                              : t("models.antigravity.officialPageMissing")}
                          </div>
                          <div>
                            {t("models.antigravity.availabilityOutcomeLabel")}:{" "}
                            {describeAvailabilityOutcome(selectedModel, t)}
                          </div>
                          {selectedModel.official?.raw_text ? (
                            <pre className="overflow-x-auto rounded-large border border-default-200 bg-content2/65 p-4 text-xs leading-6 text-default-700 dark:text-default-300">
                              {selectedModel.official.raw_text}
                            </pre>
                          ) : null}
                        </CardBody>
                      </Card>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-12 text-sm text-default-600">
                    <Spinner size="sm" />
                    {t("common.loading")}
                  </div>
                )}
              </ModalBody>
              {selectedModel ? (
                <ModalFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      startContent={<Copy className="h-4 w-4" />}
                      variant="flat"
                      onPress={async () => {
                        try {
                          await navigator.clipboard.writeText(selectedModel.id);
                          notify({
                            variant: "success",
                            title: t("models.actions.copyModelId"),
                            description: t(
                              "models.antigravity.copyModelIdSuccess",
                              {
                                modelId: selectedModel.id,
                              },
                            ),
                          });
                        } catch (error) {
                          const fallback = t("models.antigravity.copyModelIdFailed");
                          notify({
                            variant: "error",
                            title: t("models.actions.copyModelId"),
                            description: localizeApiErrorDisplay(
                              t,
                              error,
                              fallback,
                            ).label,
                          });
                        }
                      }}
                    >
                      {t("models.actions.copyModelId")}
                    </Button>
                    {selectedModel.official?.source_url ? (
                      <Button
                        size="sm"
                        startContent={<ExternalLink className="h-4 w-4" />}
                        variant="light"
                        onPress={() => {
                          window.open(
                            selectedModel.official.source_url,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        }}
                      >
                        {t("models.detail.openOfficialPage")}
                      </Button>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="light"
                    onPress={() => setSelectedModelId(null)}
                  >
                    {t("common.close")}
                  </Button>
                </ModalFooter>
              ) : null}
            </>
          )}
        </ModalContent>
      </Modal>
    </PageContent>
  );
}
