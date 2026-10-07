import { ErrorBanner, PageHeader, TabBar } from "./CommercialUI.tsx";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import { ProjectPartiesPanel } from "./ProjectPartiesPanel.tsx";
import { listAccounts, listCountries, type Me } from "../api/customer-api.ts";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "../api/project-api.ts";

/**
 * Projects, in both languages.
 *
 * This screen was written in English and never localized — not one string ran
 * through the locale, so in Arabic it printed "Projects", "All scoped
 * countries" and "Select a project to open Project 360" among screens that
 * were entirely Arabic. It also drew its pager above the list it pages
 * through, which is why "Previous 1 Next" sat under the heading with nothing
 * above it.
 */
export function ProjectPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const { projectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const granted = useMemo(() => new Set(me.access.permissions), [me]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [countryCode, setCountryCode] = useState("");
  const [archiveState, setArchiveState] = useState<
    "ACTIVE" | "ARCHIVED" | "ALL"
  >("ACTIVE");
  const [showCreate, setShowCreate] = useState(false);
  const countries = useQuery({
    queryKey: ["reference-countries"],
    queryFn: () => listCountries(client),
  });
  const scopedCountries = useMemo(() => {
    const allowedCountries = new Set(me.access.countryScope.countryCodes);
    return (countries.data ?? []).filter((country) =>
      allowedCountries.has(country.countryCode),
    );
  }, [countries.data, me.access.countryScope.countryCodes]);
  const projects = useQuery({
    queryKey: ["projects", search, countryCode, archiveState, page],
    queryFn: () =>
      listProjects(client, {
        page,
        limit: 25,
        sort: "updatedAt:desc",
        archiveState,
        ...(search === "" ? {} : { search }),
        ...(countryCode === "" ? {} : { countryCode }),
      }),
  });
  const detail = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => {
      if (projectId === undefined) {
        return Promise.reject(new Error("PROJECT_ID_REQUIRED"));
      }
      return getProject(client, projectId);
    },
    enabled: projectId !== undefined,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["account-projects"] });
  };

  if (projectId)
    return (
      <section className="workspace-page">
        <ErrorBanner error={detail.error} retry={() => void detail.refetch()} />
        {detail.data && (
          <ProjectDetailView
            client={client}
            me={me}
            project={detail.data.data}
            onChanged={refresh}
          />
        )}
      </section>
    );
  return (
    <section className="customer-page">
      <PageHeader
        screenId="PROJECTS"
        kicker={txt("Sales core", "المبيعات")}
        title={txt("Projects", "المشروعات")}
        sub={txt(
          "A project's country is its own, not the customer's head office — and it is the country that decides who may see it.",
          "بلد المشروع بتاعته هو، مش بلد مقر العميل — وهو اللي بيحدد مين يقدر يشوفه.",
        )}
        {...(typeof projects.data?.meta.total === "number"
          ? { count: projects.data.meta.total }
          : {})}
        actions={
          granted.has(permissions.projectsCreate) ? (
            <button
              className="primary"
              onClick={() => {
                setShowCreate((value) => !value);
              }}
            >
              {showCreate
                ? txt("Cancel", "إلغاء")
                : txt("New project", "مشروع جديد")}
            </button>
          ) : undefined
        }
      />
      <ErrorBanner
        error={projects.error}
        retry={() => void projects.refetch()}
      />

      {showCreate && (
        <CreateProjectForm
          client={client}
          countries={scopedCountries}
          onCreated={async (id) => {
            setShowCreate(false);
            await refresh();
            await navigate(`/sales/projects/${id}`);
          }}
        />
      )}

      <div className="customer-layout">
        <div className="panel customer-list-panel">
          <div className="filters">
            <input
              aria-label={txt("Search projects", "ابحث في المشروعات")}
              placeholder={txt(
                "Search project or reference",
                "اسم المشروع أو رقمه",
              )}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            <select
              aria-label={txt("Project country", "بلد المشروع")}
              value={countryCode}
              onChange={(event) => {
                setCountryCode(event.target.value);
              }}
            >
              <option value="">
                {txt("All countries you cover", "كل البلاد اللي بتغطيها")}
              </option>
              {scopedCountries.map((country) => (
                <option key={country.countryCode} value={country.countryCode}>
                  {country.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label={txt("Project archive state", "حالة الأرشفة")}
              value={archiveState}
              onChange={(event) => {
                setArchiveState(event.target.value as typeof archiveState);
              }}
            >
              <option value="ACTIVE">{txt("Active", "نشط")}</option>
              <option value="ARCHIVED">{txt("Archived", "مؤرشف")}</option>
              <option value="ALL">{txt("All", "الكل")}</option>
            </select>
          </div>
          {projects.isLoading && (
            <ProjectStatus
              text={txt("Loading projects…", "بيحمّل المشروعات…")}
            />
          )}
          {projects.error && (
            <ProjectStatus
              text={txt(
                "Projects could not be loaded.",
                "مش قادر يحمّل المشروعات.",
              )}
              tone="error"
            />
          )}
          {!projects.isLoading &&
            projects.error === null &&
            (projects.data?.data.length ?? 0) === 0 && (
              <ProjectStatus
                text={txt(
                  "No project matches these filters.",
                  "مفيش مشروع مطابق للفلاتر دي.",
                )}
              />
            )}
          <div className="customer-list">
            {projects.data?.data.map((project) => (
              <button
                className={
                  project.projectId === projectId
                    ? "customer-row selected"
                    : "customer-row"
                }
                key={project.projectId}
                onClick={() => {
                  void navigate(`/sales/projects/${project.projectId}`);
                }}
              >
                <strong>{project.name}</strong>
                <span>
                  {project.projectRef} · {project.geography.country.displayName}
                </span>
                <small>{enumLabel(project.recordStatusCode, locale)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="panel detail-panel">
          {projectId === undefined && (
            <ProjectStatus
              text={txt(
                "Pick a project on the right to see everything filed against it.",
                "اختار مشروع من على اليمين عشان تشوف كل حاجة متسجلة عليه.",
              )}
            />
          )}
          {detail.isLoading && (
            <ProjectStatus text={txt("Opening…", "بيفتح…")} />
          )}
          {detail.error && (
            <ProjectStatus
              text={txt(
                "This project is outside the countries you are allowed to see.",
                "المشروع ده بره البلاد المسموح لك تشوفها.",
              )}
              tone="error"
            />
          )}
          {detail.data && (
            <ProjectDetailView
              client={client}
              me={me}
              project={detail.data.data}
              onChanged={refresh}
            />
          )}
        </div>
      </div>

      {/* Below the list, because a pager above one pages nothing. */}
      <footer className="pagination">
        <button
          disabled={page === 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          {txt("Previous", "السابق")}
        </button>
        <span>{page}</span>
        <button
          disabled={(projects.data?.data.length ?? 0) < 25}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {txt("Next", "التالي")}
        </button>
      </footer>
    </section>
  );
}

function CreateProjectForm({
  client,
  countries,
  onCreated,
}: {
  client: ApiClient;
  countries: readonly { countryCode: string; displayName: string }[];
  onCreated: (projectId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [primaryAccountId, setPrimaryAccountId] = useState("");
  const [primaryRoleCode, setPrimaryRoleCode] = useState("");
  const [message, setMessage] = useState<string>();
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const accounts = useQuery({
    queryKey: ["project-account-options", accountSearch],
    queryFn: () =>
      listAccounts(client, {
        page: 1,
        limit: 25,
        archiveState: "ACTIVE",
        sort: "canonicalName:asc",
        ...(accountSearch === "" ? {} : { search: accountSearch }),
      }),
  });
  const mutation = useMutation({
    mutationFn: () =>
      createProject(client, {
        name,
        countryCode,
        primaryAccountId,
        primaryRoleCode,
      }),
    onSuccess: ({ data }) => {
      void onCreated(data.projectId);
    },
    onError: (failure) => {
      setMessage(projectErrorText(failure, locale));
    },
  });
  return (
    <form
      className="panel create-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h2>{txt("Create project", "مشروع جديد")}</h2>
      <label>
        {txt("Project name", "اسم المشروع")}
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <label>
        {txt("Project country", "بلد المشروع")}
        <select
          required
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value);
          }}
        >
          <option value="">{txt("Choose a country", "اختار بلد")}</option>
          {countries.map((country) => (
            <option key={country.countryCode} value={country.countryCode}>
              {country.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        {txt("Find the main customer", "دوّر على العميل الأساسي")}
        <input
          value={accountSearch}
          onChange={(e) => {
            setAccountSearch(e.target.value);
          }}
        />
      </label>
      <label>
        {txt("Main customer", "العميل الأساسي")}
        <select
          required
          value={primaryAccountId}
          onChange={(e) => {
            setPrimaryAccountId(e.target.value);
          }}
        >
          <option value="">{txt("Choose a customer", "اختار عميل")}</option>
          {accounts.data?.data.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {account.canonicalName} · {account.accountRef}
            </option>
          ))}
        </select>
      </label>
      <label>
        {txt("What this customer is on the project", "دور العميل في المشروع")}
        <input
          required
          placeholder={txt("Approved role code", "كود الدور المعتمد")}
          value={primaryRoleCode}
          onChange={(e) => {
            setPrimaryRoleCode(e.target.value);
          }}
        />
      </label>
      {message && <ProjectStatus text={message} tone="error" />}
      <button className="primary" disabled={mutation.isPending}>
        {mutation.isPending
          ? txt("Creating…", "بيتعمل…")
          : txt("Create project", "اعمل المشروع")}
      </button>
    </form>
  );
}

function ProjectDetailView({
  client,
  me,
  project,
  onChanged,
}: {
  client: ApiClient;
  me: Me;
  project: Awaited<ReturnType<typeof getProject>>["data"];
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState("overview");
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const granted = new Set(me.access.permissions);
  const [name, setName] = useState(project.name);
  const [city, setCity] = useState(project.city ?? "");
  const [region, setRegion] = useState(project.region ?? "");
  const [stageCode, setStageCode] = useState(project.stageCode ?? "");
  const [archiveReason, setArchiveReason] = useState("");
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    setName(project.name);
    setCity(project.city ?? "");
    setRegion(project.region ?? "");
    setStageCode(project.stageCode ?? "");
    setMessage(undefined);
  }, [
    project.projectId,
    project.rowVersion,
    project.name,
    project.city,
    project.region,
    project.stageCode,
  ]);
  const update = useMutation({
    mutationFn: () =>
      updateProject(client, project.projectId, project.rowVersion, {
        name,
        city: city || null,
        region: region || null,
        stageCode: stageCode || null,
      }),
    onSuccess: () => {
      void onChanged();
    },
    onError: (failure) => {
      setMessage(projectErrorText(failure, locale));
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      archiveProject(
        client,
        project.projectId,
        project.rowVersion,
        archiveReason,
      ),
    onSuccess: () => {
      void onChanged();
    },
    onError: (failure) => {
      setMessage(projectErrorText(failure, locale));
    },
  });
  return (
    <article>
      <div className="detail-title">
        <div>
          <span className="eyebrow" data-abp-caption>
            {project.projectRef}
          </span>
          <h2>{project.name}</h2>
        </div>
        <span className={`badge ${project.recordStatusCode.toLowerCase()}`}>
          {enumLabel(project.recordStatusCode, locale)}
        </span>
      </div>
      <TabBar
        tabs={[
          { id: "overview", en: "Overview", ar: "نظرة عامة" },
          { id: "parties", en: "Project parties", ar: "أطراف المشروع" },
          { id: "edit", en: "Manage project", ar: "إدارة المشروع" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "overview" && (
        <dl>
          <div>
            <dt>{txt("Project country", "بلد المشروع")}</dt>
            <dd>{project.geography.country.displayName}</dd>
          </div>
          <div>
            <dt>{txt("Continent", "القارة")}</dt>
            <dd>{enumLabel(project.geography.continent, locale)}</dd>
          </div>
          <div>
            <dt>{txt("Market", "السوق")}</dt>
            <dd>{enumLabel(project.geography.marketScope, locale)}</dd>
          </div>
        </dl>
      )}
      {tab === "parties" && (
        <ProjectPartiesPanel
          client={client}
          me={me}
          parties={project.parties}
          onChanged={onChanged}
        />
      )}
      {tab === "edit" &&
        granted.has(permissions.projectsEdit) &&
        project.recordStatusCode === "ACTIVE" && (
          <form
            className="edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate();
            }}
          >
            <h3>{txt("Edit project", "تعديل المشروع")}</h3>
            <label>
              {txt("Name", "الاسم")}
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("City", "المدينة")}
              <input
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Region", "المنطقة")}
              <input
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Stage code", "كود المرحلة")}
              <input
                value={stageCode}
                onChange={(e) => {
                  setStageCode(e.target.value);
                }}
              />
            </label>
            <button disabled={update.isPending}>
              {update.isPending
                ? txt("Saving…", "بيحفظ…")
                : txt("Save project", "احفظ المشروع")}
            </button>
          </form>
        )}
      {tab === "edit" &&
        granted.has(permissions.projectsArchive) &&
        project.recordStatusCode === "ACTIVE" && (
          <form
            className="archive-form"
            onSubmit={(event) => {
              event.preventDefault();
              archive.mutate();
            }}
          >
            <label>
              {txt("Why are you archiving it?", "بتأرشفه ليه؟")}
              <input
                required
                minLength={3}
                value={archiveReason}
                onChange={(e) => {
                  setArchiveReason(e.target.value);
                }}
              />
            </label>
            <button className="danger" disabled={archive.isPending}>
              {txt("Archive project", "أرشف المشروع")}
            </button>
          </form>
        )}
      {message && <ProjectStatus text={message} tone="error" />}
    </article>
  );
}

function ProjectStatus({ text, tone }: { text: string; tone?: "error" }) {
  return <p className={tone === "error" ? "status error" : "status"}>{text}</p>;
}

function projectErrorText(error: unknown, locale: "en" | "ar"): string {
  if (error instanceof Error) return error.message;
  return locale === "ar"
    ? "الطلب مكملش. جرّب تاني."
    : "The request did not go through. Try again.";
}
