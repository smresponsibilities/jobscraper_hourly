/**
 * Simplify-inspired ATS DOM clipping & tracking identity extractor.
 * Reverse-engineered from Simplify Copilot extension rules.
 */

export interface AtsIdentity {
  ats: string;
  token?: string;
  jobId?: string;
  companySlug?: string;
  canonicalUrl?: string;
}

export interface AtsDomSelectors {
  container?: string;
  jobTitle: string;
  jobDescription: string;
  jobLocation?: string;
  jobCompany?: string;
}

export const ATS_DOM_SELECTORS: Record<string, AtsDomSelectors> = {
  greenhouse: {
    container: '#app_body #content, .job__description, .job-description',
    jobTitle: 'h1.app-title, h1.job-title, .job-title',
    jobDescription: '#content, #app_body, .job__description',
    jobLocation: '.location',
    jobCompany: '.company-name',
  },
  workday: {
    container: 'div[data-automation-id="jobPostingDescription"]',
    jobTitle: 'h2[data-automation-id="jobPostingHeader"]',
    jobDescription: 'div[aria-label="Job Posting Description"] div[data-automation-id="jobPostingDescription"]',
    jobLocation: 'div[aria-label="Job Posting Description"] div[data-automation-id="locations"] dl dd',
    jobCompany: 'img[data-automation-id="banner"]',
  },
  lever: {
    container: '.posting-page, .job-posting',
    jobTitle: '.posting-headline h2, h2.posting-headline',
    jobDescription: '.content-wrapper, .posting-page .content',
    jobLocation: '.posting-categories .location',
    jobCompany: '.main-header-logo img',
  },
  ashby: {
    container: 'main, [class*="descriptionText"]',
    jobTitle: 'h1',
    jobDescription: '[class*="descriptionText"]',
    jobLocation: '[class*="location"], [data-testid="location"]',
    jobCompany: 'img[class*="navLogo"]',
  },
  smartrecruiters: {
    container: '.job-sections, .job-detail',
    jobTitle: 'h1.job-title, [itemprop="title"]',
    jobDescription: '.job-sections, [itemprop="description"]',
    jobLocation: '[itemprop="address"]',
    jobCompany: '[itemprop="hiringOrganization"]',
  },
  taleo: {
    container: '.contentdescription, .jobdetail',
    jobTitle: 'h1.subtitle, .jobtitle',
    jobDescription: '.contentdescription, #requisitionDescriptionInterface',
    jobLocation: '.location',
    jobCompany: '.companyname',
  },
  icims: {
    container: '.iCIMS_JobContent, .iCIMS_MainWrapper',
    jobTitle: '.iCIMS_Header h1, h1#iCIMS_Header',
    jobDescription: '.iCIMS_JobContent .iCIMS_Expandable_Content',
    jobLocation: '.iCIMS_JobHeaderGroup .iCIMS_JobHeaderTag',
    jobCompany: '.iCIMS_CompanyProfileHeader',
  },
  workable: {
    container: '[data-ui="job-description"]',
    jobTitle: 'h1[data-ui="job-title"]',
    jobDescription: '[data-ui="job-description"]',
    jobLocation: '[data-ui="job-location"]',
    jobCompany: '[data-ui="company-name"]',
  },
  bamboohr: {
    container: '.BambooHR-ATS-Jobs-Item, #BambooHR-ATS',
    jobTitle: 'h2, h1',
    jobDescription: '.BambooHR-ATS-Jobs-Item-Description, .BambooHR-ATS-Department-Description',
    jobLocation: '.BambooHR-ATS-Jobs-Item-Location',
    jobCompany: '.BambooHR-ATS-Company-Name',
  },
  jobvite: {
    container: '.jv-job-detail',
    jobTitle: '.jv-header, h2.jv-header',
    jobDescription: '.jv-job-detail-description',
    jobLocation: '.jv-job-detail-meta',
    jobCompany: '.jv-company-name',
  },
  breezy: {
    container: '.position-description, .job-details',
    jobTitle: 'h1',
    jobDescription: '.description, .position-description',
    jobLocation: '.location',
    jobCompany: '.company-name',
  },
  recruitee: {
    container: '.offer-description, .careers-details',
    jobTitle: 'h1.offer-title, h1',
    jobDescription: '.offer-description',
    jobLocation: '.offer-location',
    jobCompany: '.company-name',
  },
  rippling: {
    container: '[data-qa="job-description"]',
    jobTitle: 'h1[data-qa="job-title"]',
    jobDescription: '[data-qa="job-description"]',
    jobLocation: '[data-qa="job-location"]',
    jobCompany: '[data-qa="company-name"]',
  },
  eightfold: {
    container: '.position-job-description',
    jobTitle: 'h1.position-title',
    jobDescription: '.position-job-description',
    jobLocation: '.position-location',
    jobCompany: '.company-name',
  },
  jazzhr: {
    container: '#job-description',
    jobTitle: 'h1',
    jobDescription: '#job-description',
    jobLocation: '.location',
    jobCompany: '.brand-name',
  },
  linkedin: {
    container: '#job-details, .show-more-less-html__markup',
    jobTitle: '.job-details-jobs-unified-top-card__job-title, h1.top-card-layout__title',
    jobDescription: '#job-details, .show-more-less-html__markup',
    jobLocation: '.job-details-jobs-unified-top-card__bullet, .topcard__flavor--bullet',
    jobCompany: '.job-details-jobs-unified-top-card__company-name, a.topcard__org-name-link',
  },
  indeed: {
    container: '#jobDescriptionText',
    jobTitle: '.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"]',
    jobDescription: '#jobDescriptionText',
    jobLocation: '[data-testid="job-location"], #jobLocationText',
    jobCompany: '[data-testid="inlineHeader-companyName"], .jobsearch-CompanyInfoContainer a',
  },
  naukri: {
    container: 'section#job_header, section[class*="styles_job-desc-container__"]',
    jobTitle: 'section#job_header h1[class*="styles_jd-header-title__"], h1.styles_jd-header-title__',
    jobDescription: 'div[class*="styles_JDC__dang-inner-html__"], section[class*="styles_job-desc-container__"]',
    jobLocation: 'section#job_header span[class*="styles_jhc__location__"], span.styles_jhc__location__',
    jobCompany: 'section#job_header div[class*="styles_jd-header-comp-name__"] a, .styles_jd-header-comp-name__ a',
  },
  freshteam: {
    container: 'div[class*="job-details"]',
    jobTitle: 'div[class*="job-details-header"] h1[class*="brand-color"], h1.brand-color',
    jobDescription: 'div[class*="job-details-content"] > div',
    jobLocation: 'div[class*="job-details-header"] h1[class*="brand-color"] + div',
    jobCompany: 'header h4[class*="brand-text"]',
  },
};

/**
 * Extracts ATS and canonical job identity from a URL string or search params.
 */
export function extractAtsIdentity(urlStr: string): AtsIdentity | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    // 1. Greenhouse
    if (host.includes('greenhouse.io')) {
      const match = path.match(/\/(?:embed\/)?([^/]+)\/jobs\/(\d+)/i);
      if (match && match[1] && match[2]) {
        return {
          ats: 'greenhouse',
          companySlug: match[1],
          jobId: match[2],
          token: match[1],
          canonicalUrl: `https://boards.greenhouse.io/${match[1]}/jobs/${match[2]}`,
        };
      }
      const token = url.searchParams.get('token') || url.searchParams.get('gh_jid');
      const company = url.searchParams.get('for');
      if (token) {
        return {
          ats: 'greenhouse',
          companySlug: company ?? undefined,
          jobId: token,
          token: company ?? undefined,
          canonicalUrl: company ? `https://boards.greenhouse.io/${company}/jobs/${token}` : undefined,
        };
      }
    }

    // Embedded greenhouse with ?gh_jid=123
    const ghJid = url.searchParams.get('gh_jid');
    if (ghJid) {
      return {
        ats: 'greenhouse',
        jobId: ghJid,
        canonicalUrl: urlStr,
      };
    }

    // 2. Workday
    if (host.includes('myworkdayjobs.com') || host.includes('myworkdaysite.com')) {
      // Formats: /tenant/site/job/location/jobId or /site/job/jobId or /job/jobId or /details/jobId
      const parts = path.split('/').filter(Boolean);
      // Hostname format: tenant.wdX.myworkdayjobs.com
      const tenantMatch = host.match(/^([^.]+)\./);
      const tenant = tenantMatch ? tenantMatch[1] : parts[0] || 'unknown';

      const jobIdx = parts.findIndex(p => p === 'job' || p === 'details');
      if (jobIdx !== -1 && jobIdx + 1 < parts.length) {
        const jobId = parts[parts.length - 1];
        return {
          ats: 'workday',
          companySlug: tenant,
          token: tenant,
          jobId,
          canonicalUrl: urlStr.split('?')[0],
        };
      }
    }

    // 3. Lever
    if (host.includes('jobs.lever.co')) {
      // /company/uuid
      const match = path.match(/^\/([^/]+)\/([a-f0-9-]+)/i);
      if (match && match[1] && match[2]) {
        return {
          ats: 'lever',
          companySlug: match[1],
          token: match[1],
          jobId: match[2],
          canonicalUrl: `https://jobs.lever.co/${match[1]}/${match[2]}`,
        };
      }
    }

    // 4. Ashby
    if (host.includes('ashbyhq.com')) {
      // /company/jobId
      const match = path.match(/^\/([^/]+)\/([^/]+)/i);
      if (match && match[1] && match[2]) {
        return {
          ats: 'ashby',
          companySlug: match[1],
          token: match[1],
          jobId: match[2],
          canonicalUrl: `https://jobs.ashbyhq.com/${match[1]}/${match[2]}`,
        };
      }
    }

    // 5. SmartRecruiters
    if (host.includes('smartrecruiters.com')) {
      // /company/jobId
      const match = path.match(/\/(?:company\/)?([^/]+)\/(?:publication\/)?([a-f0-9-]+|[0-9]+)/i);
      if (match && match[1] && match[2]) {
        return {
          ats: 'smartrecruiters',
          companySlug: match[1],
          token: match[1],
          jobId: match[2],
          canonicalUrl: `https://jobs.smartrecruiters.com/${match[1]}/${match[2]}`,
        };
      }
    }

    // 6. Workable
    if (host.includes('workable.com')) {
      // apply.workable.com/company/j/jobId
      const match = path.match(/\/([^/]+)\/j\/([A-Za-z0-9]+)/i);
      if (match && match[1] && match[2]) {
        return {
          ats: 'workable',
          companySlug: match[1],
          token: match[1],
          jobId: match[2],
          canonicalUrl: `https://apply.workable.com/${match[1]}/j/${match[2]}/`,
        };
      }
    }

    // 7. BambooHR
    if (host.includes('bamboohr.com')) {
      const match = path.match(/\/careers\/([a-zA-Z0-9_-]+)/i);
      const companyMatch = host.match(/^([^.]+)\.bamboohr\.com/i);
      const company = companyMatch ? companyMatch[1] : undefined;
      const jobId = match ? match[1] : url.searchParams.get('id') || undefined;
      if (jobId) {
        return {
          ats: 'bamboohr',
          companySlug: company,
          token: company,
          jobId,
          canonicalUrl: company ? `https://${company}.bamboohr.com/careers/${jobId}` : urlStr,
        };
      }
    }

    // 8. Jobvite
    if (host.includes('jobvite.com')) {
      const match = path.match(/\/([^/]+)\/job\/([a-zA-Z0-9_-]+)/i);
      if (match && match[1] && match[2]) {
        return {
          ats: 'jobvite',
          companySlug: match[1],
          token: match[1],
          jobId: match[2],
          canonicalUrl: `https://jobs.jobvite.com/${match[1]}/job/${match[2]}`,
        };
      }
    }

    // 9. Breezy HR
    if (host.includes('breezy.hr')) {
      const match = path.match(/\/p\/([a-zA-Z0-9_-]+)/i);
      const companyMatch = host.match(/^([^.]+)\.breezy\.hr/i);
      const company = companyMatch ? companyMatch[1] : undefined;
      if (match && match[1]) {
        return {
          ats: 'breezy',
          companySlug: company,
          token: company,
          jobId: match[1],
          canonicalUrl: urlStr.split('?')[0],
        };
      }
    }

    // 10. Recruitee
    if (host.includes('recruitee.com')) {
      const match = path.match(/\/o\/([a-zA-Z0-9_-]+)/i);
      const companyMatch = host.match(/^([^.]+)\.recruitee\.com/i);
      const company = companyMatch ? companyMatch[1] : undefined;
      if (match && match[1]) {
        return {
          ats: 'recruitee',
          companySlug: company,
          token: company,
          jobId: match[1],
          canonicalUrl: urlStr.split('?')[0],
        };
      }
    }

    // 11. Rippling
    if (host.includes('rippling-ats.com') || host.includes('rippling.com')) {
      const match = path.match(/\/job\/([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) {
        return {
          ats: 'rippling',
          jobId: match[1],
          canonicalUrl: urlStr.split('?')[0],
        };
      }
    }

    // 12. Taleo
    if (host.includes('taleo.net')) {
      const job = url.searchParams.get('job');
      const companyMatch = host.match(/^([^.]+)\.taleo\.net/i);
      if (job) {
        return {
          ats: 'taleo',
          companySlug: companyMatch ? companyMatch[1] : undefined,
          jobId: job,
          canonicalUrl: urlStr,
        };
      }
    }

    // 13. iCIMS
    if (host.includes('icims.com')) {
      const match = path.match(/\/jobs\/(\d+)\//i);
      const companyMatch = host.match(/^([^.]+)\.icims\.com/i);
      if (match && match[1]) {
        return {
          ats: 'icims',
          companySlug: companyMatch ? companyMatch[1] : undefined,
          jobId: match[1],
          canonicalUrl: urlStr.split('?')[0],
        };
      }
    }

    // 14. LinkedIn
    if (host.includes('linkedin.com')) {
      const match = path.match(/\/jobs\/view\/(\d+)/i) || path.match(/\/jobs\/collections\/.*currentJobId=(\d+)/i);
      const jobId = match ? match[1] : url.searchParams.get('currentJobId');
      if (jobId) {
        return {
          ats: 'linkedin',
          jobId,
          canonicalUrl: `https://www.linkedin.com/jobs/view/${jobId}/`,
        };
      }
    }

    // 15. Indeed
    if (host.includes('indeed.com')) {
      const jk = url.searchParams.get('jk') || (path.match(/\/viewjob\?jk=([a-f0-9]+)/i)?.[1]);
      if (jk) {
        return {
          ats: 'indeed',
          jobId: jk,
          canonicalUrl: `https://www.indeed.com/viewjob?jk=${jk}`,
        };
      }
    }

    // 16. Eightfold
    if (host.includes('eightfold.ai')) {
      const jobId = url.searchParams.get('jobId') || path.split('/').filter(Boolean).pop();
      const companyMatch = host.match(/^([^.]+)\.eightfold\.ai/i);
      if (jobId) {
        return {
          ats: 'eightfold',
          companySlug: companyMatch ? companyMatch[1] : undefined,
          jobId,
          canonicalUrl: urlStr,
        };
      }
    }

    // 17. Naukri
    if (host.includes('naukri.com')) {
      const naukriMatch = urlStr.match(/naukri\.com\/job-listings-(?:[^/?#]*-)?(\d{9,})/i);
      if (naukriMatch && naukriMatch[1]) {
        return {
          ats: 'naukri',
          jobId: naukriMatch[1],
          canonicalUrl: `https://www.naukri.com/job-listings-${naukriMatch[1]}`,
        };
      }
    }

    // 18. FreshTeam
    if (host.includes('freshteam.com')) {
      const ftMatch = path.match(/\/jobs\/([^/?#]+)/i);
      const companyMatch = host.match(/^([^.]+)\.freshteam\.com/i);
      if (ftMatch && ftMatch[1]) {
        return {
          ats: 'freshteam',
          companySlug: companyMatch ? companyMatch[1] : undefined,
          jobId: ftMatch[1],
          canonicalUrl: urlStr,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Returns DOM selectors for a given ATS name.
 */
export function getAtsSelectors(ats: string): AtsDomSelectors | undefined {
  return ATS_DOM_SELECTORS[ats.toLowerCase()];
}
