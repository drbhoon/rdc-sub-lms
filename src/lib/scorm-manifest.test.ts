import { describe, expect, it } from "vitest";
import { ScormManifestError, parseScormManifest, parseXml } from "./scorm-manifest";

// Trimmed from the shape Articulate Storyline writes for SCORM 1.2.
const STORYLINE_12 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="Goal_Setting" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="Goal_ORG">
    <organization identifier="Goal_ORG">
      <title>Goal Setting &amp; Getting Things Done</title>
      <item identifier="item_1" identifierref="RES_1" isvisible="true">
        <title>Goal Setting</title>
        <adlcp:masteryscore>80</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_1" type="webcontent" adlcp:scormtype="sco" href="index_lms.html">
      <file href="index_lms.html"/>
    </resource>
  </resources>
</manifest>`;

const STORYLINE_2004 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="CPS" version="1.3" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 3rd Edition</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>Creative Problem Solving</title>
      <item identifier="i1" identifierref="RES">
        <title>Creative Problem Solving</title>
        <imsss:sequencing><imsss:objectives><imsss:primaryObjective objectiveID="o"><imsss:minNormalizedMeasure>0.8</imsss:minNormalizedMeasure></imsss:primaryObjective></imsss:objectives></imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources><resource identifier="RES" type="webcontent" adlcp:scormType="sco" href="index_lms.html"/></resources>
</manifest>`;

describe("parseScormManifest", () => {
  it("reads a SCORM 1.2 single-unit package", () => {
    expect(parseScormManifest(STORYLINE_12)).toEqual({
      version: "1.2", title: "Goal Setting & Getting Things Done", launchPath: "index_lms.html", masteryScore: 80, scoCount: 1,
    });
  });
  it("reads a SCORM 2004 package and its pass mark from the sequencing", () => {
    expect(parseScormManifest(STORYLINE_2004)).toEqual({
      version: "2004", title: "Creative Problem Solving", launchPath: "index_lms.html", masteryScore: 80, scoCount: 1,
    });
  });
  it("keeps the launch parameters", () => {
    const xml = STORYLINE_12.replace('identifierref="RES_1" isvisible="true"', 'identifierref="RES_1" parameters="?mode=lms"');
    expect(parseScormManifest(xml).launchPath).toBe("index_lms.html?mode=lms");
  });
  it("puts the xml:base in front of the launch file", () => {
    const xml = STORYLINE_12.replace('<resource identifier="RES_1"', '<resource xml:base="content/" identifier="RES_1"');
    expect(parseScormManifest(xml).launchPath).toBe("content/index_lms.html");
  });
  it("tells a 1.2 package from a 2004 one without the version tag", () => {
    expect(parseScormManifest(STORYLINE_12.replace("<schemaversion>1.2</schemaversion>", "")).version).toBe("1.2");
    expect(parseScormManifest(STORYLINE_2004.replace("<schemaversion>2004 3rd Edition</schemaversion>", "")).version).toBe("2004");
  });
  it("refuses a package with several separate units", () => {
    const xml = STORYLINE_12
      .replace("</item>\n    </organization>", "</item>\n      <item identifier=\"item_2\" identifierref=\"RES_2\"><title>Two</title></item>\n    </organization>")
      .replace("</resources>", '<resource identifier="RES_2" type="webcontent" href="two.html"/></resources>');
    expect(() => parseScormManifest(xml)).toThrow(/2 separate units/);
  });
  it("accepts one resource shown by several menu items", () => {
    const xml = STORYLINE_12.replace("</item>\n    </organization>", "</item>\n      <item identifier=\"item_2\" identifierref=\"RES_1\"><title>Again</title></item>\n    </organization>");
    expect(parseScormManifest(xml).scoCount).toBe(1);
  });
  it("refuses things that are not SCORM manifests", () => {
    expect(() => parseScormManifest("<html></html>")).toThrow(ScormManifestError);
    expect(() => parseScormManifest(STORYLINE_12.replace(/<metadata>[\s\S]*<\/metadata>/, "").replace("adlcp_rootv1p2", "other"))).toThrow(/SCORM version/);
  });
  it("refuses a package with nothing to launch", () => {
    expect(() => parseScormManifest(STORYLINE_12.replace('identifierref="RES_1"', ""))).toThrow(/nothing to launch/);
  });
});

describe("parseXml", () => {
  it("ignores comments, declarations and CDATA markers, and decodes entities", () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b><![CDATA[<raw>]]></b><c/></a>');
    expect(root.attrs.x).toBe("1 & 2");
    expect(root.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(root.children[0].text).toBe("<raw>");
  });
});
