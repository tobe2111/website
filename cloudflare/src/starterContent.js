// 실전용 시작 세트 — 새로 개설한 '진짜 고객사' 사이트를 빈 화면으로 넘기지 않기 위한 것.
//
// 데모 채우기(demoContent.js)와는 목적이 반대입니다.
//   데모   : 영업 시연용. 가짜 점포·회원을 만들고 기존 내용을 지운 뒤 갈아 끼웁니다.
//   시작세트: 실제 운영 시작용. 가짜 점포·회원은 만들지 않고, **비어 있는 것만** 채웁니다.
//            이미 공지를 쓴 상인회에 다시 실행해도 덮어쓰지 않습니다.
//
// 문구는 어느 상인회에서나 그대로 게시할 수 있게 쓰되, 상인회 이름·연락처는 실제 값을 넣습니다.
import * as D from "./db.js";
import { contentHash } from "./esign.js";

const notices = (assoc) => {
  const call = assoc.phone ? `사무실(${assoc.phone})로 연락 주세요.` : "상인회 사무실로 연락 주세요.";
  return [
    { tag: "소식", pinned: 1, title: `${assoc.name} 홈페이지를 열었습니다`,
      body: `${assoc.name} 홈페이지를 열었습니다.

앞으로 공지와 행사 안내를 이곳에 올립니다. 종이 안내문을 못 보셨거나 놓치신 내용도 여기서 다시 확인하실 수 있습니다.

가입 점포는 가게 소개·영업시간·메뉴·쿠폰을 사장님이 직접 올리실 수 있습니다. 스마트폰으로도 됩니다.
처음 쓰실 때 어려우시면 ${call}` },

    { tag: "안내", pinned: 0, title: "가입 점포를 모집합니다",
      body: `우리 상권의 가게를 홈페이지에 함께 싣습니다.

올릴 수 있는 것
· 가게 소개와 사진
· 영업시간, 휴무일, 전화번호, 찾아오는 길
· 대표 메뉴·상품과 가격
· 손님께 드리는 쿠폰

비용은 들지 않습니다. 가입을 원하시는 사장님은 ${call}
상인회에서 초대 링크를 보내 드리면, 링크를 눌러 몇 가지만 입력하시면 됩니다.` },

    { tag: "안내", pinned: 0, title: "회비 납부 안내",
      body: `회비 납부 내역은 상인회에서 장부로 관리합니다.

납부하신 뒤 사무실에 알려 주시면 그달 납부로 기록됩니다. 본인 납부 여부가 궁금하시면 언제든 확인해 드립니다.

영수증이나 증빙이 필요하신 분은 미리 말씀해 주세요.` },
  ];
};

// 상인회가 실제로 받아야 하는 첫 서류. 서명 요청은 걸지 않고 문서만 만들어 둡니다
// (누구에게 돌릴지는 상인회가 정할 일이므로).
const CONSENT_DOC = (assoc) => ({
  title: "상인회 가입 신청 및 개인정보 수집·이용 동의서",
  body: `본인은 ${assoc.name}에 가입을 신청하며, 아래 내용에 동의합니다.

1. 수집 항목
   성명, 연락처, 점포명, 점포 주소, 이메일

2. 수집·이용 목적
   회원 관리, 공지·행사 안내, 회비 납부 기록, 홈페이지 점포 정보 게시

3. 보유 기간
   회원 자격이 유지되는 동안 보유하며, 탈퇴 시 지체 없이 파기합니다.
   다만 법령에서 보존을 정한 경우 그 기간을 따릅니다.

4. 동의를 거부할 권리
   동의를 거부하실 수 있습니다. 다만 회원 관리를 위한 최소 정보이므로,
   거부하시는 경우 가입 절차를 진행하기 어렵습니다.

5. 홈페이지 게시
   점포명·주소·연락처·영업시간·메뉴 등 영업에 관한 정보는 홈페이지에 공개됩니다.
   공개를 원하지 않는 항목은 언제든 사무실에 말씀하시면 내리겠습니다.

위 내용을 확인하였으며, 개인정보 수집·이용에 동의합니다.`,
});

/**
 * 비어 있는 항목만 채웁니다. 이미 있는 것은 건드리지 않습니다.
 * 반환값의 skipped 에 '이미 있어서 넘어간 것'이 담깁니다.
 */
export async function seedStarter(env, db, assoc, { createdBy = null } = {}) {
  const aid = assoc.id;
  const added = { notices: 0, documents: 0 };
  const skipped = [];

  const noticeCount = (await db.prepare("SELECT COUNT(*) AS n FROM notices WHERE association_id=?").bind(aid).first()).n;
  if (noticeCount > 0) skipped.push("공지");
  else {
    for (const n of notices(assoc)) {
      await db.prepare("INSERT INTO notices (association_id, title, body, tag, pinned) VALUES (?,?,?,?,?)")
        .bind(aid, n.title, n.body, n.tag, n.pinned).run();
      added.notices++;
    }
  }

  const docCount = (await db.prepare("SELECT COUNT(*) AS n FROM documents WHERE association_id=?").bind(aid).first()).n;
  if (docCount > 0) skipped.push("전자서명 문서");
  else {
    const doc = CONSENT_DOC(assoc);
    await D.createDocument(db, {
      associationId: aid, title: doc.title, body: doc.body,
      contentHash: await contentHash(doc.body), createdBy, ordered: 0, dueDate: "",
    });
    added.documents++;
  }

  return { ...added, skipped };
}
