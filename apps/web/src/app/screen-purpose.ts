/**
 * What each screen is for, and where its figures come from.
 *
 * A screen that shows a correct table and says nothing about itself is still a
 * screen nobody trusts: the two questions people actually ask in front of one
 * are "what am I supposed to do here" and "where did this number come from",
 * and neither is answered by a title. Both answers live here, once, so they
 * cannot drift apart from screen to screen the way hand-written blurbs do.
 *
 * `purpose` is the decision the screen supports, written as a sentence a
 * salesperson would say — not a description of the data model. It is always
 * visible, in the header's own subtitle slot, so it costs no extra space.
 *
 * `source` is provenance in the reader's terms: which system the rows come
 * from, and what limits what they can see. It sits behind a disclosure that is
 * closed by default, because it answers a question people ask once per screen
 * rather than every visit — showing it permanently would be the crowding it is
 * meant to relieve.
 */
export interface ScreenPurpose {
  purpose: { en: string; ar: string };
  source: { en: string; ar: string };
}

export const screenPurpose: Record<string, ScreenPurpose> = {
  HOME: {
    purpose: {
      en: "Your commercial position in one view: what is open, what is slipping, and what needs you first.",
      ar: "موقفك التجاري في شاشة واحدة: إيه المفتوح، وإيه اللي بيتأخر، وإيه اللي محتاجك دلوقتي.",
    },
    source: {
      en: "Built live from your own opportunities, quotations and action queue, limited to the countries you are allowed to see.",
      ar: "محسوبة لحظيًا من الفرص وعروض الأسعار وطابور المهام بتاعتك، وفي حدود الدول المسموح لك بيها.",
    },
  },
  SEARCH: {
    purpose: {
      en: "One box for every record — customers, contacts, projects, quotations and products at once.",
      ar: "خانة واحدة لكل السجلات — عملاء وجهات اتصال ومشاريع وعروض أسعار ومنتجات مرة واحدة.",
    },
    source: {
      en: "Searches the live database. Results only ever include records you already have permission to open.",
      ar: "بيدوّر في قاعدة البيانات مباشرة. النتايج بتيجي بس من السجلات اللي معاك صلاحية تفتحها.",
    },
  },
  CUSTOMERS: {
    purpose: {
      en: "The companies you sell to — who owns each account, and which ones have gone quiet.",
      ar: "الشركات اللي بتبيع لها — مين مسؤول عن كل حساب، ومين فيهم سكت.",
    },
    source: {
      en: "The accounts register. Every new customer is checked against it for duplicates before it is created.",
      ar: "سجل الحسابات. أي عميل جديد بيتشيّك عليه فيه ضد التكرار قبل ما يتعمل.",
    },
  },
  CUSTOMER_DETAIL: {
    purpose: {
      en: "One customer, end to end: who to call, what is quoted, what shipped, and what is still owed.",
      ar: "عميل واحد من الأول للآخر: مين تكلّمه، وإيه اللي اتسعّر، وإيه اللي اتشحن، وإيه اللي لسه مستحق.",
    },
    source: {
      en: "Assembled live from every module that references this account — nothing on this screen is typed twice.",
      ar: "بتتجمّع لحظيًا من كل الموديولات اللي بتشاور على الحساب ده — مفيش حاجة هنا بتتكتب مرتين.",
    },
  },
  CONTACTS: {
    purpose: {
      en: "The people rather than the companies — who actually answers the phone at each customer.",
      ar: "الأشخاص مش الشركات — مين اللي بيرد فعلًا عند كل عميل.",
    },
    source: {
      en: "Contacts attached to accounts in your scope, plus any a colleague has shared with you.",
      ar: "جهات الاتصال المرتبطة بحسابات في نطاقك، وكمان اللي زميل شاركهالك.",
    },
  },
  CONTACT_DETAIL: {
    purpose: {
      en: "One person's file: how to reach them, which accounts they sit on, and what was last discussed.",
      ar: "ملف شخص واحد: تتواصل معاه إزاي، وعلى أنهي حسابات، وآخر كلام اتقال معاه.",
    },
    source: {
      en: "The contact record and its channels, with the activity history written against it.",
      ar: "سجل جهة الاتصال وقنواتها، ومعاه تاريخ الأنشطة المسجّلة عليها.",
    },
  },
  PROJECTS: {
    purpose: {
      en: "The construction jobs you are quoting against. A project is what ties several quotations to one site.",
      ar: "المشاريع اللي بتسعّر لها. المشروع هو اللي بيربط أكتر من عرض سعر بموقع واحد.",
    },
    source: {
      en: "The projects register, with the parties, opportunities and quotations already linked to each one.",
      ar: "سجل المشاريع، ومعاه الأطراف والفرص وعروض الأسعار المربوطة بكل مشروع.",
    },
  },
  PROJECT_DETAIL: {
    purpose: {
      en: "One site in full: who is on it, what has been quoted, and how much of it you have won.",
      ar: "موقع واحد بالكامل: مين عليه، وإيه اللي اتسعّر، وكسبت منه قد إيه.",
    },
    source: {
      en: "The project record plus every opportunity, quotation and party attached to it.",
      ar: "سجل المشروع وكل فرصة وعرض سعر وطرف مربوط بيه.",
    },
  },
  OPPORTUNITIES: {
    purpose: {
      en: "Every live deal and the stage it is in — the list you work down, not a report you read.",
      ar: "كل صفقة شغالة والمرحلة اللي هي فيها — ليستة بتشتغل عليها، مش تقرير بتقراه.",
    },
    source: {
      en: "The opportunity pipeline. Weighted values use each deal's own probability, not a flat assumption.",
      ar: "خط الفرص. القيم المرجّحة بتستخدم احتمالية كل صفقة بنفسها، مش نسبة ثابتة على الكل.",
    },
  },
  OPPORTUNITY_DETAIL: {
    purpose: {
      en: "One deal: its value, its stage, what is blocking it, and every quotation raised against it.",
      ar: "صفقة واحدة: قيمتها ومرحلتها وإيه اللي مأخّرها وكل عرض سعر اتعمل عليها.",
    },
    source: {
      en: "The opportunity record, its stage history, and the quotations that point back to it.",
      ar: "سجل الفرصة وتاريخ مراحلها وعروض الأسعار اللي بتشاور عليها.",
    },
  },
  ACTIVITIES: {
    purpose: {
      en: "Calls, visits and follow-ups — logged so the next person on the account is not starting cold.",
      ar: "مكالمات وزيارات ومتابعات — متسجّلة عشان اللي بعدك على الحساب ميبدأش من الصفر.",
    },
    source: {
      en: "The activity log. Each entry stays attached to the customer, contact or opportunity it was about.",
      ar: "سجل الأنشطة. كل نشاط بيفضل مربوط بالعميل أو جهة الاتصال أو الفرصة اللي كان بخصوصها.",
    },
  },
  CALENDAR: {
    purpose: {
      en: "The same activities on a calendar, so you can see the week rather than read a list.",
      ar: "نفس الأنشطة على تقويم، تشوف الأسبوع بدل ما تقرا ليستة.",
    },
    source: {
      en: "The same activity log as the list view — one record, two ways of looking at it.",
      ar: "نفس سجل الأنشطة بتاع شاشة الليستة — سجل واحد بطريقتين عرض.",
    },
  },
  PRODUCTS: {
    purpose: {
      en: "Find the right SKU before you price it — by code, by description, or by the dimensions you were given.",
      ar: "تلاقي الكود الصح قبل ما تسعّره — بالكود أو بالوصف أو بالمقاسات اللي وصلتلك.",
    },
    source: {
      en: "The ERP product catalogue, plus the item resolver that maps a customer's wording onto a real SKU.",
      ar: "كتالوج منتجات الـERP، ومعاه محلّل الأصناف اللي بيحوّل كلام العميل لكود حقيقي.",
    },
  },
  QUOTATIONS: {
    purpose: {
      en: "Every quotation and where it stands — draft, waiting on an approval, sent, or won.",
      ar: "كل عروض الأسعار وموقف كل واحد — مسودة، مستنية موافقة، مبعوتة، أو مكسوبة.",
    },
    source: {
      en: "The quotation register. Totals are the saved figures from each quotation, not recalculated here.",
      ar: "سجل عروض الأسعار. الإجماليات هي الأرقام المحفوظة في كل عرض، مش بتتحسب تاني هنا.",
    },
  },
  QUOTATION_WIZARD: {
    purpose: {
      en: "Start a quotation in the right order: customer, then project, then the lines to price.",
      ar: "تبدأ عرض سعر بالترتيب الصح: العميل، بعده المشروع، بعده البنود اللي هتتسعّر.",
    },
    source: {
      en: "Reads your existing customers and opportunities so a quotation is never raised against a name that is not on file.",
      ar: "بيقرا عملاءك وفرصك الموجودة عشان العرض ميتعملش على اسم مش متسجّل.",
    },
  },
  QUOTATION_DETAIL: {
    purpose: {
      en: "Price the job: board rates, weights, discounts, terms and totals, with every figure showing where it came from.",
      ar: "تسعّر الشغلانة: أسعار الألواح والأوزان والخصومات والشروط والإجماليات، وكل رقم مكتوب جاي منين.",
    },
    source: {
      en: "Rates come from the company pricing basis unless this quotation or a single line overrides them — the applied source is shown on each line.",
      ar: "الأسعار جاية من أساس التسعير بتاع الشركة إلا لو العرض ده أو بند لوحده غيّرها — والمصدر المطبّق مكتوب على كل بند.",
    },
  },
  CUSTOMER_ORDERS: {
    purpose: {
      en: "Orders booked from accepted quotations, and where each one stands between confirmation and hand-over.",
      ar: "الأوردرات اللي اتحجزت من عروض الأسعار المتقبَلة، وكل أوردر واقف فين من التأكيد لحد التسليم.",
    },
    source: {
      en: "Booked here from the accepted quotation: lines, prices, VAT and payment schedule are copied as the customer accepted them.",
      ar: "بتتحجز هنا من عرض السعر المتقبَل: البنود والأسعار والضريبة وجدول الدفع بتتنقل زي ما العميل وافق عليها.",
    },
  },
  CUSTOMER_ORDER_DETAIL: {
    purpose: {
      en: "One order: what was agreed, what changed since, and the next step it is waiting for.",
      ar: "أوردر واحد: اتفقنا على إيه، اتغيّر إيه من ساعتها، ومستني الخطوة الجاية إيه.",
    },
    source: {
      en: "Copied from its quotation at booking; every amendment and status change is kept in its history with who made it.",
      ar: "متنسخ من عرض السعر وقت الحجز؛ وكل تعديل أو تغيير حالة محفوظ في السجل باسم اللي عمله.",
    },
  },
  FINANCE_RECEIVABLES: {
    purpose: {
      en: "What customers still owe on their orders, how late it is, and what came in this month.",
      ar: "العملاء لسه عليهم كام في أوردراتهم، متأخرين قد إيه، واتحصّل كام الشهر ده.",
    },
    source: {
      en: "Each confirmed order's payment schedule, split into installments; after-delivery cheques are dated when the order is handed over. Recorded collections are also posted as payments.",
      ar: "جدول الدفع بتاع كل أوردر مؤكَّد، متقسّم لأقساط؛ والشيكات اللي بعد التسليم بتاخد تاريخها لما الأوردر يتسلّم. وكل تحصيل بيتسجّل كمان كدفعة.",
    },
  },
  ERP_ORDERS: {
    purpose: {
      en: "What actually became an order after the quotation was won — the reality check on the pipeline.",
      ar: "إيه اللي بقى أوردر فعلًا بعد ما العرض اتكسب — ده اللي بيراجع خط الفرص.",
    },
    source: {
      en: "Mirrored from the ERP. This screen reads them; orders are not created or edited here.",
      ar: "منسوخة من الـERP. الشاشة دي بتقراها بس؛ الأوردرات مش بتتعمل ولا بتتعدّل من هنا.",
    },
  },
  ERP_ORDER_DETAIL: {
    purpose: {
      en: "One order line by line, against the quotation it came from.",
      ar: "أوردر واحد بند بند، مقارنة بالعرض اللي جه منه.",
    },
    source: {
      en: "Mirrored from the ERP, linked back to its quotation where the reference matched.",
      ar: "منسوخ من الـERP، ومربوط بعرض السعر بتاعه لما الرقم المرجعي طابق.",
    },
  },
  CAPACITY: {
    purpose: {
      en: "Can the factory actually make this, and by when — before you promise a date.",
      ar: "المصنع يقدر يعمل ده فعلًا ولا لأ، وإمتى — قبل ما توعد بتاريخ.",
    },
    source: {
      en: "Uses the capacity rates an administrator maintains, applied to the quantities you enter.",
      ar: "بيستخدم معدلات الطاقة اللي بيحدّثها المسؤول، مطبّقة على الكميات اللي بتدخّلها.",
    },
  },
  CAPACITY_ESTIMATE: {
    purpose: {
      en: "A saved estimate kept as it was calculated, so a promised date can be defended later.",
      ar: "تقدير محفوظ زي ما اتحسب، عشان تقدر تدافع عن التاريخ اللي وعدت بيه بعدين.",
    },
    source: {
      en: "The rates in force on the day it was run — later rate changes do not rewrite it.",
      ar: "المعدلات اللي كانت سارية يوم ما اتحسب — تغيير المعدلات بعد كده مش بيعدّله.",
    },
  },
  LOGISTICS: {
    purpose: {
      en: "How the goods get there and what that costs — the part of the price that is not the product.",
      ar: "البضاعة هتوصل إزاي وبكام — الجزء من السعر اللي مش تمن المنتج.",
    },
    source: {
      en: "Plans you and your colleagues have saved, each with the lanes and rates it was built from.",
      ar: "خطط محفوظة منك ومن زمايلك، وكل واحدة معاها المسارات والأسعار اللي اتبنت عليها.",
    },
  },
  LOGISTICS_PLAN: {
    purpose: {
      en: "Build one shipping plan: containers, lanes, cost per route, and the option you would defend.",
      ar: "تبني خطة شحن واحدة: الحاويات والمسارات وتكلفة كل طريق والاختيار اللي هتدافع عنه.",
    },
    source: {
      en: "Your entered cargo against the saved transport rates; nothing is estimated silently.",
      ar: "البضاعة اللي دخّلتها ضد أسعار النقل المحفوظة؛ مفيش حاجة بتتقدّر من ورا ظهرك.",
    },
  },
  CARGO_LOADER: {
    purpose: {
      en: "Prove the load actually fits: pack the boards into the container in 3D before you book it.",
      ar: "تتأكد إن الحمولة داخلة فعلًا: ترصّ الألواح جوه الحاوية بالأبعاد التلاتة قبل ما تحجز.",
    },
    source: {
      en: "A quotation's own lines with the dimensions the calculation worked out — or figures you type in, to check an idea before any quotation exists.",
      ar: "بنود عرض سعر بمقاساتها اللي الحساب طلعها — أو أرقام بتكتبها بنفسك، تجرب فكرة قبل ما يبقى فيه عرض أصلًا.",
    },
  },
  FINANCE_FX: {
    purpose: {
      en: "The exchange rate a quotation was priced at, kept on the record so a later move is visible.",
      ar: "سعر الصرف اللي العرض اتسعّر بيه، محفوظ في السجل عشان أي تغيّر بعده يبان.",
    },
    source: {
      en: "Rates entered and dated by finance. Quotations capture the rate in force when they were priced.",
      ar: "أسعار بتدخّلها المالية بتاريخها. العروض بتاخد السعر السائد وقت التسعير.",
    },
  },
  FINANCE_PAYMENTS: {
    purpose: {
      en: "What the customer has actually paid, and which invoices it was set against.",
      ar: "العميل دفع فعلًا كام، والفلوس دي اتحطت على أنهي فواتير.",
    },
    source: {
      en: "Payments recorded by finance, with their allocations. Unallocated money is shown as unallocated.",
      ar: "مدفوعات بتسجّلها المالية بتوزيعاتها. الفلوس غير الموزّعة بتتعرض كده صراحة.",
    },
  },
  FINANCE_PAYMENT: {
    purpose: {
      en: "One payment and exactly where it went.",
      ar: "دفعة واحدة وراحت فين بالظبط.",
    },
    source: {
      en: "The payment record and the allocations written against it.",
      ar: "سجل الدفعة والتوزيعات المسجّلة عليها.",
    },
  },
  FINANCE_CHEQUES: {
    purpose: {
      en: "Cheques in hand and when each one clears — money promised is not money received.",
      ar: "الشيكات اللي في إيدك وكل واحد بيتحصّل إمتى — الفلوس الموعودة مش فلوس مقبوضة.",
    },
    source: {
      en: "The cheque register kept by finance, with each cheque's own due and clearing dates.",
      ar: "سجل الشيكات بتاع المالية، وكل شيك بتاريخ استحقاقه وتحصيله.",
    },
  },
  RETURNS: {
    purpose: {
      en: "Boards coming back — what condition, whose fault, and what it costs to settle.",
      ar: "ألواح راجعة — حالتها إيه، وغلط مين، وتسويتها بكام.",
    },
    source: {
      en: "Returned-scrap cases raised by sales or the customer, with their inspection outcome.",
      ar: "حالات المرتجع اللي بيفتحها المبيعات أو العميل، ومعاها نتيجة الفحص.",
    },
  },
  RETURN_DETAIL: {
    purpose: {
      en: "One return case: the claim, the inspection, and the decision.",
      ar: "حالة مرتجع واحدة: الشكوى والفحص والقرار.",
    },
    source: {
      en: "The case record with its inspection notes and settlement.",
      ar: "سجل الحالة بملاحظات الفحص والتسوية.",
    },
  },
  IMPORTS: {
    purpose: {
      en: "Bring a spreadsheet in without trusting it blindly — review what it would change, then commit.",
      ar: "تدخّل شيت من غير ما تثق فيه على عماه — تراجع هيغيّر إيه، وبعدين تعتمده.",
    },
    source: {
      en: "The file you uploaded, parsed into proposed rows. Nothing is written until you accept the review.",
      ar: "الملف اللي رفعته، متحلّل لصفوف مقترحة. مفيش حاجة بتتكتب غير لما توافق على المراجعة.",
    },
  },
  IMPORT_JOB: {
    purpose: {
      en: "One import, row by row: what was accepted, what was rejected, and why.",
      ar: "عملية استيراد واحدة صف صف: إيه اللي اتقبل، وإيه اللي اترفض، وليه.",
    },
    source: {
      en: "The parsed file and the validation result recorded for each row.",
      ar: "الملف المتحلّل ونتيجة التحقق المسجّلة لكل صف.",
    },
  },
  DQ: {
    purpose: {
      en: "Where the data is wrong before it reaches a customer — duplicates, gaps and mismatches.",
      ar: "الداتا غلط فين قبل ما توصل لعميل — تكرارات ونواقص وتعارضات.",
    },
    source: {
      en: "Rules run over the live records. Each issue names the record it is about so it can be fixed at source.",
      ar: "قواعد بتشتغل على السجلات الحية. كل مشكلة بتقول على أنهي سجل عشان تتصلّح من أصلها.",
    },
  },
  RECONCILIATION: {
    purpose: {
      en: "Does the CRM still agree with the ERP — and if not, on exactly which records.",
      ar: "الـCRM لسه متطابق مع الـERP ولا لأ — ولو لأ، على أنهي سجلات بالظبط.",
    },
    source: {
      en: "Comparison runs between the two systems. Each run keeps its own findings rather than overwriting the last.",
      ar: "عمليات مقارنة بين النظامين. كل تشغيلة بتحتفظ بنتايجها بدل ما تمسح اللي قبلها.",
    },
  },
  DOCUMENTS: {
    purpose: {
      en: "Every file the deal produced, kept against the record it belongs to instead of in someone's inbox.",
      ar: "كل ملف الصفقة طلّعته، محفوظ على السجل بتاعه بدل ما يبقى في إيميل حد.",
    },
    source: {
      en: "Documents uploaded or generated by the system, filtered to the records you can already see.",
      ar: "مستندات مرفوعة أو مولّدة من النظام، ومفلترة على السجلات اللي بتشوفها أصلًا.",
    },
  },
  NOTIFICATIONS: {
    purpose: {
      en: "What happened while you were away, in the order it happened.",
      ar: "حصل إيه وإنت مش موجود، بالترتيب اللي حصل بيه.",
    },
    source: {
      en: "Events the system raised about records you own or follow.",
      ar: "أحداث النظام سجّلها على سجلات إنت مسؤول عنها أو متابعها.",
    },
  },
  ACTIONS: {
    purpose: {
      en: "The short list of things only you can clear, ranked so the top of it is the right place to start.",
      ar: "الليستة القصيرة بتاعة اللي مش هيتقفل غير منك، مرتّبة عشان أولها يكون البداية الصح.",
    },
    source: {
      en: "Derived from your records' own states — overdue follow-ups, waiting approvals, stalled deals.",
      ar: "مستخرجة من حالات سجلاتك نفسها — متابعات فاتت، وموافقات مستنية، وصفقات واقفة.",
    },
  },
  REPORTS: {
    purpose: {
      en: "The numbers behind the quarter: pipeline, quotation throughput, conversion and orders.",
      ar: "أرقام الربع سنة: خط الفرص، ومعدل عروض الأسعار، والتحويل، والأوردرات.",
    },
    source: {
      en: "Aggregated live from the same records the list screens show — a figure here can always be traced to rows.",
      ar: "بتتجمّع لحظيًا من نفس السجلات اللي في شاشات الليستة — أي رقم هنا ترجعه لصفوف.",
    },
  },
  TARGETS: {
    purpose: {
      en: "The company's number for the year, and how far through it you are.",
      ar: "رقم الشركة للسنة، وإنت وصلت منه لفين.",
    },
    source: {
      en: "Targets set by management, measured against won orders — not against quotations sent.",
      ar: "أهداف بتحطها الإدارة، متقاسة على الأوردرات المكسوبة — مش على العروض المبعوتة.",
    },
  },
  AI: {
    purpose: {
      en: "A written read of your accounts: what changed, what it suggests, and what it is unsure about.",
      ar: "قراءة مكتوبة لحساباتك: إيه اللي اتغيّر، وبيقترح إيه، ومش متأكد من إيه.",
    },
    source: {
      en: "Generated from your own records at the moment you asked. Advice, not a decision — the records stay the authority.",
      ar: "مولّدة من سجلاتك وقت ما طلبتها. نصيحة مش قرار — السجلات هي المرجع.",
    },
  },
  MARKET_SIGNALS: {
    purpose: {
      en: "Tenders, launches and news worth a call — the reason to phone before the enquiry arrives.",
      ar: "مناقصات وافتتاحات وأخبار تستاهل مكالمة — السبب اللي يخليك تكلّم قبل ما الطلب ييجي.",
    },
    source: {
      en: "Signals entered by the commercial team. Each one keeps its source and date so it can be judged.",
      ar: "إشارات بيدخّلها الفريق التجاري. كل واحدة محتفظة بمصدرها وتاريخها عشان تتحكم عليها.",
    },
  },
  TARGET_MARKETS: {
    purpose: {
      en: "Which countries and segments are worth the effort this year, and why.",
      ar: "أنهي دول وقطاعات تستاهل المجهود السنة دي، وليه.",
    },
    source: {
      en: "Maintained by the commercial team, not derived — this is a stated intention, not a measurement.",
      ar: "بيحدّثها الفريق التجاري، مش محسوبة — دي نية معلنة مش قياس.",
    },
  },
  TARGET_ACCOUNTS: {
    purpose: {
      en: "The named companies you are deliberately going after, separate from whoever happens to enquire.",
      ar: "الشركات اللي بتروح لها بقصد، غير اللي بيصادف ويسأل.",
    },
    source: {
      en: "A list the commercial team keeps by hand, linked to the account record once one exists.",
      ar: "ليستة بيمسكها الفريق التجاري بإيده، بتترابط بسجل الحساب أول ما يتعمل.",
    },
  },
  COMPETITORS: {
    purpose: {
      en: "Who you keep losing to and on what — so the next quotation answers it in advance.",
      ar: "بتخسر لمين وعلى إيه — عشان العرض الجاي يرد على ده من الأول.",
    },
    source: {
      en: "Competitor records plus the lost-reason captured on closed opportunities.",
      ar: "سجلات المنافسين مع سبب الخسارة المسجّل على الفرص المقفولة.",
    },
  },
  WATCHLIST: {
    purpose: {
      en: "The handful of accounts and projects you want to hear about the moment anything moves.",
      ar: "الحسابات والمشاريع القليلة اللي عايز تعرف أول ما يتحرك فيها حاجة.",
    },
    source: {
      en: "Records you chose to follow. Nothing is added to it automatically.",
      ar: "سجلات إنت اخترت تتابعها. مفيش حاجة بتتضاف لها لوحدها.",
    },
  },
  REPEAT_BUSINESS: {
    purpose: {
      en: "Customers due another order on their own pattern — the cheapest sale there is.",
      ar: "عملاء جه ميعادهم لأوردر تاني حسب نمطهم — أرخص بيعة ممكنة.",
    },
    source: {
      en: "Requests raised against past order history; the suggested timing comes from that customer's own cycle.",
      ar: "طلبات بتتعمل على تاريخ الأوردرات السابقة؛ والتوقيت المقترح من دورة العميل نفسه.",
    },
  },
  ADMIN_USERS: {
    purpose: {
      en: "Who can sign in, what they can reach, and how to get a locked-out colleague back to work.",
      ar: "مين يقدر يدخل، وبيوصل لإيه، وترجّع الزميل المقفول عليه للشغل إزاي.",
    },
    source: {
      en: "The identity register. Every change here is written to the audit trail with your name on it.",
      ar: "سجل الهويات. أي تغيير هنا بيتكتب في سجل التدقيق باسمك.",
    },
  },
  ADMIN_ROLES: {
    purpose: {
      en: "What each role is allowed to do, in one place, instead of permission by permission per person.",
      ar: "كل دور مسموح له بإيه، في مكان واحد، بدل صلاحية صلاحية لكل شخص.",
    },
    source: {
      en: "The permission catalogue the API itself enforces — this screen edits the same list the server checks.",
      ar: "كتالوج الصلاحيات اللي الـAPI نفسه بيطبّقه — الشاشة دي بتعدّل نفس الليستة اللي السيرفر بيتشيّك عليها.",
    },
  },
  ADMIN_COUNTRIES: {
    purpose: {
      en: "Which countries each person can see. This is the boundary every other screen obeys.",
      ar: "كل شخص يشوف أنهي دول. ده الحد اللي كل الشاشات التانية بتمشي عليه.",
    },
    source: {
      en: "The country scope on each user, enforced server-side on every request — not hidden in the UI.",
      ar: "نطاق الدول على كل مستخدم، مطبّق في السيرفر على كل طلب — مش مجرد إخفاء في الواجهة.",
    },
  },
  ADMIN_POLICIES: {
    purpose: {
      en: "The commercial rules quotations must obey: payment terms, tax, and the limits on discounting.",
      ar: "القواعد التجارية اللي العروض لازم تمشي عليها: شروط الدفع والضريبة وحدود الخصم.",
    },
    source: {
      en: "Versioned policy rows. A change creates a new version — quotations already priced keep the old one.",
      ar: "سياسات بإصدارات. أي تعديل بيعمل إصدار جديد — والعروض المسعّرة قبله بتفضل على القديم.",
    },
  },
  ADMIN_FORMULAS: {
    purpose: {
      en: "The formulas that turn dimensions into a price, written down instead of living in a spreadsheet.",
      ar: "المعادلات اللي بتحوّل المقاسات لسعر، مكتوبة في النظام بدل ما تكون في شيت.",
    },
    source: {
      en: "The calculation rules the pricing engine runs. Editing one affects new pricing, not saved quotations.",
      ar: "قواعد الحساب اللي محرّك التسعير بيشغّلها. تعديلها بيأثر على التسعير الجديد، مش على العروض المحفوظة.",
    },
  },
  ADMIN_PRICING: {
    purpose: {
      en: "The company's default board rates and density — the numbers every quotation starts from.",
      ar: "أسعار الألواح والكثافة الافتراضية للشركة — الأرقام اللي كل عرض سعر بيبدأ منها.",
    },
    source: {
      en: "The pricing basis, kept as dated versions. A quotation records the version it used, so old ones never change.",
      ar: "أساس التسعير، محفوظ كإصدارات بتواريخ. كل عرض بيسجّل الإصدار اللي استخدمه، فالقديم مبيتغيّرش.",
    },
  },
  ADMIN_CAPACITY: {
    purpose: {
      en: "The production rates every capacity estimate is calculated from.",
      ar: "معدلات الإنتاج اللي كل تقدير طاقة بيتحسب منها.",
    },
    source: {
      en: "Maintained here by operations. Estimates already saved keep the rate they were run with.",
      ar: "بتحدّثها العمليات من هنا. والتقديرات المحفوظة بتفضل على المعدل اللي اتحسبت بيه.",
    },
  },
  ADMIN_IMPORT: {
    purpose: {
      en: "Where imported data is allowed to come from, and what each source is trusted to change.",
      ar: "الداتا المستوردة مسموح تيجي منين، وكل مصدر مسموح له يغيّر إيه.",
    },
    source: {
      en: "Configured import sources and the jobs run from each one.",
      ar: "مصادر الاستيراد المعرّفة والعمليات اللي اتشغّلت من كل واحد.",
    },
  },
  ADMIN_DQ: {
    purpose: {
      en: "The rules that decide what counts as bad data, and the mappings that stop the same mistake twice.",
      ar: "القواعد اللي بتقرر إيه اللي يعتبر داتا غلط، والربط اللي بيمنع تكرار نفس الغلطة.",
    },
    source: {
      en: "Rule definitions and item-resolver mappings. Changing a rule re-scores the open issues.",
      ar: "تعريفات القواعد وربط الأصناف. تغيير قاعدة بيعيد تقييم المشاكل المفتوحة.",
    },
  },
  ADMIN_TEMPLATES: {
    purpose: {
      en: "The layout of what the customer receives — so every quotation leaves looking like ACROW.",
      ar: "شكل اللي بيوصل للعميل — عشان كل عرض يخرج بهوية أكرو.",
    },
    source: {
      en: "Document templates used when a quotation or contract is generated. Editing one affects the next document, not those already sent.",
      ar: "قوالب المستندات اللي بتتستخدم وقت توليد عرض أو عقد. تعديل قالب بيأثر على المستند الجاي، مش المبعوت خلاص.",
    },
  },
  ADMIN_AUDIT: {
    purpose: {
      en: "Who changed what, and when — the record you reach for when an answer is disputed.",
      ar: "مين غيّر إيه وإمتى — السجل اللي بترجعله لما حد يعترض على إجابة.",
    },
    source: {
      en: "Written by the server on every change. It cannot be edited from the application, only read and exported.",
      ar: "بيكتبه السيرفر مع كل تغيير. مش بيتعدّل من التطبيق، بيتقرا ويتصدّر بس.",
    },
  },
  COMPLAINTS: {
    purpose: {
      en: "What customers are unhappy about, who owns it, and whether it is moving.",
      ar: "العملاء زعلانين من إيه، ومين مسؤول، والموضوع ماشي ولا واقف.",
    },
    source: {
      en: "Cases logged by Sales and routed Operations → Quality → solution → closed; each stage has whoever holds it and a deadline, shorter for high and critical cases.",
      ar: "شكاوى بتسجّلها المبيعات وبتمشي عمليات ← جودة ← حل ← قفل؛ كل مرحلة ليها مسؤول وميعاد، وبيقصر للشكاوى العالية والحرجة.",
    },
  },
  COMPLAINT_DETAIL: {
    purpose: {
      en: "One complaint: what was claimed, what was found, and how it was closed.",
      ar: "شكوى واحدة: اتقال إيه، واتلاقى إيه، واتقفلت إزاي.",
    },
    source: {
      en: "The case record, what each stage found and decided, and every move with who made it. Cases from before the routed workflow have no history before it.",
      ar: "سجل الحالة، اللي كل مرحلة لقيته وقررته، وكل نقلة باسم اللي عملها. الشكاوى الأقدم من المسار الجديد ملهاش سجل قبله.",
    },
  },
  SHIPMENTS: {
    purpose: {
      en: "Where the goods have actually got to — the answer to the call you get every week.",
      ar: "البضاعة وصلت فين فعلًا — الرد على المكالمة اللي بتيجيلك كل أسبوع.",
    },
    source: {
      en: "Shipments planned by logistics for customer orders (and ERP export orders): load from the Cargo Loader, dispatch, the vessel and port for sea freight, delivery and the signed proof of delivery.",
      ar: "شحنات بتخططها اللوجستيات لأوامر البيع (وأوامر التصدير من الـERP): الحمولة من محمّل الحاويات، الخروج، المركب والميناء للبحري، التسليم وإثبات التسليم الموقّع.",
    },
  },
  SHIPMENT_DETAIL: {
    purpose: {
      en: "One shipment, milestone by milestone, with its documents.",
      ar: "شحنة واحدة، مرحلة بمرحلة، ومعاها مستنداتها.",
    },
    source: {
      en: "The shipment record and every step logged on it. Delivering the last shipment of a ready order hands the order over and starts its after-delivery payments.",
      ar: "سجل الشحنة وكل خطوة اتسجّلت عليها. تسليم آخر شحنة في أوردر جاهز بيسلّم الأوردر ويبدأ أقساط ما بعد التسليم.",
    },
  },
  CUSTOMER_FEEDBACK: {
    purpose: {
      en: "What customers told us, how happy they are, and whether anyone got back to them.",
      ar: "العملاء قالوا إيه، راضيين قد إيه، وحد رجعلهم ولا لأ.",
    },
    source: {
      en: "The public feedback page (no account needed). Each entry is matched by the order, quotation, proforma or item code the customer gave — or by their phone or email — to the customer and salesperson. Critical ones and problems rated 1–2 stars open a complaint automatically.",
      ar: "صفحة الآراء العامة (من غير حساب). كل رأي بيتربط بالعميل والمندوب عن طريق رقم الأوردر أو عرض السعر أو الفاتورة المبدئية أو كود الصنف اللي العميل كتبه — أو بالموبايل أو الإيميل. الحرج والمشاكل اللي تقييمها نجمة أو اتنين بتفتح شكوى لوحدها.",
    },
  },
  CUSTOMER_FEEDBACK_DETAIL: {
    purpose: {
      en: "One customer's feedback, how to reach them, and what was done about it.",
      ar: "رأي عميل واحد، إزاي نوصله، واتعمل إيه بخصوصه.",
    },
    source: {
      en: "What the customer sent, what their reference matched, and every follow-up recorded since.",
      ar: "اللي العميل بعته، المرجع بتاعه اتربط بإيه، وكل متابعة اتسجلت بعدها.",
    },
  },
  CUSTOMER_MAP: {
    purpose: {
      en: "Who we deal with near a place — customers, projects, contractors and how much business each is.",
      ar: "بنتعامل مع مين قريب من مكان معيّن — العملاء والمشاريع والمقاولين وحجم الشغل مع كل واحد.",
    },
    source: {
      en: "Customers and projects you can see, placed by a pin, else by the district or city in their address, else by country (hollow dots). Values are their customer orders and quotations, per currency.",
      ar: "العملاء والمشاريع اللي تقدر تشوفها، متحددين بالدبوس، وإلا بالحي أو المدينة في العنوان، وإلا بالدولة (النقط الفاضية). القيم من أوامر البيع وعروض الأسعار، لكل عملة.",
    },
  },
  WORK_ORDERS: {
    purpose: {
      en: "What the factory is making for which order, on which line, and whether it will be ready in time.",
      ar: "المصنع بيعمل إيه ولأنهي أوردر، على أنهي خط، وهيخلص في ميعاده ولا لأ.",
    },
    source: {
      en: "Work orders planned from confirmed customer orders; each run's length comes from the board category's capacity rate. The order follows the work: first run started = in production, last run passed QC = ready.",
      ar: "أوامر إنتاج متخططة من أوردرات مؤكدة؛ مدة كل تشغيلة من معدل الطاقة لتصنيف الألواح. والأوردر بيمشي مع الشغل: أول تشغيلة تبدأ = في الإنتاج، وآخر تشغيلة تعدّي الفحص = جاهز.",
    },
  },
  WORK_ORDER_DETAIL: {
    purpose: {
      en: "One production run: its line and dates, what was produced and rejected, and its quality check.",
      ar: "تشغيلة واحدة: الخط والمواعيد، اتنتج كام واترفض كام، وفحص الجودة.",
    },
    source: {
      en: "The work order and every step, reschedule and quality result recorded on it, with who did it.",
      ar: "أمر الإنتاج وكل خطوة وتعديل ميعاد ونتيجة فحص اتسجّلت عليه، باسم اللي عملها.",
    },
  },
  PRODUCTION_SCHEDULE: {
    purpose: {
      en: "Every line's runs on a timeline, against the dates customers were promised.",
      ar: "تشغيلات كل خط على جدول زمني، قصاد المواعيد اللي اتوعد بيها العملاء.",
    },
    source: {
      en: "Planned start and end of each work order, the customer's requested delivery date on its order, and the planned dispatch of its shipments.",
      ar: "بداية ونهاية كل أمر إنتاج المخططة، وميعاد التسليم اللي العميل طلبه على الأوردر، والخروج المخطط لشحناته.",
    },
  },
  LOGISTICS_CALENDAR: {
    purpose: {
      en: "What leaves and what arrives each day, and which promised dates have slipped.",
      ar: "إيه اللي خارج وإيه اللي واصل كل يوم، وأنهي مواعيد اتوعدنا بيها وعدّت.",
    },
    source: {
      en: "Planned and actual dispatch and delivery dates from shipments, and the delivery dates customers asked for on their orders.",
      ar: "مواعيد الخروج والتسليم المخططة والفعلية من الشحنات، ومواعيد التسليم اللي العملاء طلبوها في أوردراتهم.",
    },
  },
  RESEARCH: {
    purpose: {
      en: "What the market keeps asking for that you do not make yet — the case for a new size.",
      ar: "السوق بيطلب إيه بشكل متكرر وإنتم مش بتعملوه — المبرر لمقاس جديد.",
    },
    source: {
      en: "Counted from real enquiries and quotation lines, so the demand is evidenced rather than assumed.",
      ar: "معدودة من طلبات وبنود عروض حقيقية، فالطلب مثبت مش مفترض.",
    },
  },
  ADMIN_SEGMENTS: {
    purpose: {
      en: "How customers are grouped for pricing and reporting — and who falls into each group.",
      ar: "العملاء بيتقسموا إزاي للتسعير والتقارير — ومين في كل مجموعة.",
    },
    source: {
      en: "Segment definitions, with assignments applied to the account records themselves.",
      ar: "تعريفات القطاعات، والتصنيف بيتطبق على سجلات الحسابات نفسها.",
    },
  },
  ADMIN_SYSTEM: {
    purpose: {
      en: "Whether email leaves the system, and whether last night's backup was taken and restores.",
      ar: "الإيميل بيخرج من السيستم ولا لأ، ونسخة امبارح الاحتياطية اتاخدت وبتسترجع ولا لأ.",
    },
    source: {
      en: "The email outbox and the status file the backup service writes after every run.",
      ar: "طابور الإيميلات، وملف الحالة اللي خدمة النسخ بتكتبه بعد كل تشغيلة.",
    },
  },
  ADMIN_CLIENT_IDENTITIES: {
    purpose: {
      en: "Which customers can sign in to the client portal, and what they see when they do.",
      ar: "أنهي عملاء يقدروا يدخلوا بوابة العملاء، وبيشوفوا إيه لما يدخلوا.",
    },
    source: {
      en: "Portal identities linked to account records. Access is granted per account, never company-wide by default.",
      ar: "هويات البوابة المربوطة بسجلات الحسابات. الوصول بيتدي لكل حساب لوحده، مش للكل افتراضيًا.",
    },
  },
  PEOPLE: {
    purpose: {
      en: "Who is who on the commercial team, and how to reach them without leaving the system.",
      ar: "مين مين في الفريق التجاري، وتوصله إزاي من غير ما تسيب النظام.",
    },
    source: {
      en: "Active users with their role and country scope. Deactivated colleagues drop off automatically.",
      ar: "المستخدمين النشطين بأدوارهم ونطاق دولهم. الزمايل الموقوفين بيختفوا لوحدهم.",
    },
  },
  MESSAGES: {
    purpose: {
      en: "Talk about a deal next to the deal, so the decision and the reason for it stay together.",
      ar: "تتكلم عن الصفقة جنب الصفقة، عشان القرار وسببه يفضلوا مع بعض.",
    },
    source: {
      en: "Conversations inside the system. Read state is per person, so an unread mark is yours alone.",
      ar: "محادثات جوه النظام. حالة القراءة لكل شخص لوحده، فعلامة “غير مقروء” بتاعتك إنت بس.",
    },
  },
  APPROVALS: {
    purpose: {
      en: "The decisions other people are waiting on you for — with the figures needed to decide in the row.",
      ar: "القرارات اللي ناس مستنياك فيها — والأرقام اللي تحتاجها للقرار في نفس الصف.",
    },
    source: {
      en: "Approval requests raised by quotations. A request invalidated by a later edit is marked, not hidden.",
      ar: "طلبات موافقة جاية من عروض الأسعار. والطلب اللي بطل بسبب تعديل بعده بيتعلّم عليه مش بيتخفي.",
    },
  },
  TODAY: {
    purpose: {
      en: "Four questions answered every morning: what is slipping, what went quiet, what closes this month, who is carrying what.",
      ar: "أربع أسئلة بترد عليها كل صبح: إيه اللي بيتأخر، وإيه اللي سكت، وإيه اللي هيقفل الشهر ده، ومين شايل إيه.",
    },
    source: {
      en: "Your live opportunities and the team roster — no separate report to keep up to date.",
      ar: "فرصك الحية وكشف الفريق — مفيش تقرير منفصل محتاج تحديث.",
    },
  },
  MY_PROFILE: {
    purpose: {
      en: "How you appear to colleagues and on the documents you send.",
      ar: "شكلك قدام الزمايل وعلى المستندات اللي بتبعتها.",
    },
    source: {
      en: "Your own user record. Your role and country scope are set by an administrator, not here.",
      ar: "سجل المستخدم بتاعك. دورك ونطاق دولك بيحددهم المسؤول، مش من هنا.",
    },
  },
  SETTINGS: {
    purpose: {
      en: "Language, theme, notifications and sign-in security — the things that follow you to any device.",
      ar: "اللغة والمظهر والإشعارات وأمان الدخول — الحاجات اللي بتمشي معاك على أي جهاز.",
    },
    source: {
      en: "Saved against your account on the server, so they apply wherever you sign in.",
      ar: "محفوظة على حسابك في السيرفر، فبتشتغل في أي مكان تدخل منه.",
    },
  },
};
