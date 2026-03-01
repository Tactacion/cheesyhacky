"""
Synovia Clinical AI — Whole-Body Surgical Simulation
Kimi K2 Turbo via api.moonshot.ai
Supports: brain, liver, spleen, kidney, lung, bone/musculoskeletal
"""
from openai import OpenAI
import os, json, time
from dotenv import load_dotenv

load_dotenv()

MODEL = "kimi-k2-turbo-preview"

def _get_client():
    """Lazy client init — falls back gracefully if no API key is set."""
    key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY") or "no-key"
    return OpenAI(api_key=key, base_url="https://api.moonshot.ai/v1")

_SYSTEM = (
    "You are a board-certified trauma surgeon with expertise across all organ systems. "
    "Respond ONLY with valid JSON — no markdown fences, no prose before or after."
)

# ── Organ-specific prompt templates ────────────────────────────────────────────

_BRAIN_PROMPT = """\
Patient: age {age}, procedure: {procedure}, indication: {reason}.
Target resection: {hemisphere} {region} (normalized coords x={cx:.2f} y={cy:.2f} z={cz:.2f}).
Organ system: BRAIN / CORTICAL — viscoelastic, anisotropic white matter.

Return this exact JSON schema with medically accurate predictions:
{{
  "removalSummary": {{
    "affectedRegions": ["<2-4 specific anatomical areas>"],
    "preservedRegions": ["<2-3 areas>"],
    "eloquentCortex": true
  }},
  "neurologicalDeficits": {{
    "motor":    {{"affected": true, "description": "<concise clinical text>", "severity": "SEVERE|MODERATE|MILD|NONE", "bodyParts": ["<body part>"]}},
    "sensory":  {{"affected": true, "description": "<concise>", "severity": "MODERATE"}},
    "cognitive":{{"affected": true, "functions": ["memory","attention"], "description": "<concise>", "severity": "MODERATE"}},
    "language": {{"affected": false, "type": "none", "description": "<concise>", "severity": "NONE"}}
  }},
  "functionalImpact": {{
    "mobility": "<text>", "independence": "70%",
    "communication": "<text>", "cognition": "<text>",
    "overallQualityOfLife": "65%"
  }},
  "surgicalApproach": {{
    "recommendedApproach": "awake craniotomy",
    "mapping": {{"required": true, "methods": ["cortical stimulation"], "reason": "<text>"}},
    "margins": {{"recommended": "5mm", "eloquentProximity": "<text>"}}
  }},
  "risks": [
    {{"type": "<text>", "probability": "30%", "consequences": "<text>", "prevention": "<text>", "reversibility": "potentially reversible"}}
  ],
  "recoveryPrognosis": {{
    "neuroplasticity": {{"potential": "MODERATE", "factors": ["<factor>"], "timeline": "6-12 months"}},
    "rehabilitation":  {{"required": true, "types": ["physical therapy"], "duration": "6 months", "expectedImprovement": "70%"}},
    "longTermOutcome": {{"bestCase": "<text>", "worstCase": "<text>", "mostLikely": "<text>"}}
  }},
  "recommendations": ["<rec1>", "<rec2>", "<rec3>"]
}}"""

_GENERIC_PROMPT = """\
Patient: age {age}, procedure: {procedure}, indication: {reason}.
Target resection: {region} — volume removed: {volume}.
Organ system: {organ_system_upper} — biomechanical properties: {biomech}.

Return this exact JSON schema with medically accurate predictions for {organ_system} surgery:
{{
  "removalSummary": {{
    "affectedRegions": ["<2-4 specific anatomical sub-regions of {organ_system}>"],
    "preservedRegions": ["<2-3 preserved areas>"],
    "eloquentCortex": false
  }},
  "neurologicalDeficits": {{
    "functional_loss": {{"affected": true, "description": "<primary organ function impact>", "severity": "SEVERE|MODERATE|MILD|NONE"}},
    "systemic_impact": {{"affected": true, "description": "<systemic effects of resection>", "severity": "MODERATE"}},
    "secondary_effects": {{"affected": true, "description": "<secondary organ stress or compensation>", "severity": "MILD"}}
  }},
  "functionalImpact": {{
    "primary_function": "<percentage of {organ_system} function retained>",
    "independence": "<patient independence percentage>",
    "compensatory_mechanisms": "<how body compensates>",
    "quality_of_life": "<QoL impact description>",
    "overallQualityOfLife": "<percentage>"
  }},
  "surgicalApproach": {{
    "recommendedApproach": "<laparoscopic/open/robotic/etc>",
    "mapping": {{"required": false, "methods": ["intraoperative ultrasound"], "reason": "<text>"}},
    "margins": {{"recommended": "<margin in mm>", "eloquentProximity": "<vascular/duct proximity>"}}
  }},
  "risks": [
    {{"type": "<primary complication>", "probability": "<percentage>", "consequences": "<text>", "prevention": "<text>", "reversibility": "<permanent|potentially reversible|manageable>"}},
    {{"type": "<secondary complication>", "probability": "<percentage>", "consequences": "<text>", "prevention": "<text>", "reversibility": "<text>"}},
    {{"type": "<tertiary complication>", "probability": "<percentage>", "consequences": "<text>", "prevention": "<text>", "reversibility": "<text>"}}
  ],
  "recoveryPrognosis": {{
    "neuroplasticity": {{"potential": "MODERATE|HIGH|LOW", "factors": ["<organ-specific recovery factor>"], "timeline": "<timeline>"}},
    "rehabilitation": {{"required": true, "types": ["<rehab type>"], "duration": "<duration>", "expectedImprovement": "<percentage>"}},
    "longTermOutcome": {{"bestCase": "<text>", "worstCase": "<text>", "mostLikely": "<text>"}}
  }},
  "recommendations": ["<rec1 specific to {organ_system}>", "<rec2>", "<rec3>"]
}}"""

# ── Organ biomechanical profiles ───────────────────────────────────────────────
_ORGAN_BIOMECH = {
    "brain":   "viscoelastic anisotropic white matter, E≈2000Pa, ν≈0.45",
    "liver":   "hyperelastic highly vascularized parenchyma, E≈3000Pa, ν≈0.49, high portal blood flow",
    "spleen":  "highly compliant red pulp, E≈800Pa, ν≈0.48, rupture prone, immune organ",
    "kidney":  "stiff fibrous capsule with soft parenchyma, E≈4000Pa, ν≈0.44, dual arterial supply",
    "lung":    "poroelastic pressure-sensitive parenchyma, E≈1200Pa, ν≈0.40, surfactant-dependent",
    "bone":    "rigid cortical shell with porous trabecular core, E≈18000Pa, ν≈0.30, piezoelectric",
}


def analyze_brain_removal(procedure_type: str, removal_region: dict, patient_age: int, reason: str) -> dict:
    """Brain/cortical simulation — original entry point kept for WebSocket compatibility."""
    region     = removal_region.get("brainRegion", "unknown region")
    hemisphere = removal_region.get("hemisphere", "left")
    coords     = removal_region.get("coordinates", {"x": 0, "y": 0, "z": 0})
    volume     = removal_region.get("volumeToRemove", "30%")
    organ_id   = removal_region.get("organSystem", "brain")

    # Route to organ-specific handler
    if organ_id and organ_id != "brain":
        return analyze_organ_removal(
            organ_system=organ_id,
            procedure_type=procedure_type,
            region=region,
            volume=volume,
            patient_age=patient_age,
            reason=reason,
        )

    prompt = _BRAIN_PROMPT.format(
        age=patient_age, procedure=procedure_type, reason=reason,
        hemisphere=hemisphere, region=region,
        cx=float(coords.get("x", 0)),
        cy=float(coords.get("y", 0)),
        cz=float(coords.get("z", 0)),
    )
    return _call_ai(prompt, region, hemisphere, patient_age, organ_id)


def analyze_organ_removal(
    organ_system: str,
    procedure_type: str,
    region: str,
    volume: str,
    patient_age: int,
    reason: str,
) -> dict:
    """Whole-body surgical simulation for non-brain organ systems."""
    biomech = _ORGAN_BIOMECH.get(organ_system, "standard soft tissue, E≈2000Pa, ν≈0.45")

    prompt = _GENERIC_PROMPT.format(
        age=patient_age,
        procedure=procedure_type,
        reason=reason,
        region=region,
        volume=volume,
        organ_system=organ_system,
        organ_system_upper=organ_system.upper(),
        biomech=biomech,
    )
    return _call_ai(prompt, region, "n/a", patient_age, organ_system)


def _call_ai(prompt: str, region: str, hemisphere: str, patient_age: int, organ_id: str) -> dict:
    client = _get_client()
    for attempt in range(2):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user",   "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
                timeout=30,
            )
            text = resp.choices[0].message.content.strip()
            text = text.replace("```json", "").replace("```", "").strip()
            start, end = text.find("{"), text.rfind("}") + 1
            if start != -1 and end > start:
                text = text[start:end]
            result = json.loads(text)
            print(f"[Synovia AI] OK — {organ_id}/{region}")
            return result

        except json.JSONDecodeError as e:
            print(f"[Synovia AI] JSON parse error attempt {attempt+1}: {e}")
            if attempt == 1:
                return _fallback(region, hemisphere, patient_age, organ_id)
            time.sleep(0.5)

        except Exception as e:
            print(f"[Synovia AI] Error attempt {attempt+1}: {type(e).__name__}: {e}")
            if attempt == 1:
                return _fallback(region, hemisphere, patient_age, organ_id)
            time.sleep(1)

    return _fallback(region, hemisphere, patient_age, organ_id)


def _fallback(region: str, hemisphere: str, patient_age: int, organ_id: str = "brain") -> dict:
    """Organ-specific fallback responses when AI is unavailable."""
    is_left = hemisphere == "left"

    if organ_id == "liver":
        return {
            "removalSummary": {
                "affectedRegions": ["Hepatic parenchyma", "Portal triad", "Biliary radicles"],
                "preservedRegions": ["Contralateral lobe", "Hepatic veins", "IVC"],
                "eloquentCortex": False
            },
            "neurologicalDeficits": {
                "functional_loss": {"affected": True, "description": "Hepatic synthetic function reduced proportional to resected volume.", "severity": "MODERATE"},
                "systemic_impact": {"affected": True, "description": "Altered drug metabolism, coagulation factor synthesis reduced.", "severity": "MODERATE"},
                "secondary_effects": {"affected": True, "description": "Portal hypertension risk if >70% hepatectomy.", "severity": "MILD"}
            },
            "functionalImpact": {
                "primary_function": "60–75% function retained after 40% hepatectomy",
                "independence": "85%",
                "compensatory_mechanisms": "Hepatic regeneration begins within 48h; 90% volume recovery by 6 weeks",
                "quality_of_life": "Moderate short-term impact; near-normal long-term",
                "overallQualityOfLife": "80%"
            },
            "surgicalApproach": {
                "recommendedApproach": "Laparoscopic hepatectomy",
                "mapping": {"required": False, "methods": ["Intraoperative ultrasound"], "reason": "Vascular and biliary mapping essential"},
                "margins": {"recommended": "10mm", "eloquentProximity": "Within 5mm of hepatic vein bifurcation"}
            },
            "risks": [
                {"type": "Post-hepatectomy liver failure", "probability": "5–15%", "consequences": "Coagulopathy, encephalopathy", "prevention": "Future liver remnant volume >30%", "reversibility": "potentially reversible"},
                {"type": "Bile leak", "probability": "10–20%", "consequences": "Peritonitis, abscess", "prevention": "Intraoperative bile duct test", "reversibility": "manageable"},
                {"type": "Hemorrhage", "probability": "8–12%", "consequences": "Hemodynamic instability", "prevention": "Pringle maneuver, argon beam", "reversibility": "manageable"}
            ],
            "recoveryPrognosis": {
                "neuroplasticity": {"potential": "HIGH", "factors": ["Regenerative capacity", f"Age {patient_age}"], "timeline": "6–12 weeks"},
                "rehabilitation": {"required": True, "types": ["Nutritional support", "Hepatoprotective medications"], "duration": "3 months", "expectedImprovement": "90%"},
                "longTermOutcome": {"bestCase": "Full hepatic function recovery at 3 months.", "worstCase": "Chronic liver insufficiency requiring monitoring.", "mostLikely": "75–85% function at 6 months, progressing to near-normal."}
            },
            "recommendations": [
                "Preoperative volumetric CT to calculate future liver remnant.",
                "Portal vein embolization if FLR < 25% in healthy liver.",
                f"Patient age {patient_age}: {'favorable regeneration capacity' if patient_age < 60 else 'enhanced monitoring required post-op'}."
            ]
        }

    elif organ_id == "spleen":
        return {
            "removalSummary": {
                "affectedRegions": ["Splenic parenchyma", "White pulp", "Marginal zone"],
                "preservedRegions": ["Tail of pancreas", "Splenic flexure", "Left adrenal"],
                "eloquentCortex": False
            },
            "neurologicalDeficits": {
                "functional_loss": {"affected": True, "description": "Loss of opsonization; susceptibility to encapsulated bacteria.", "severity": "MODERATE"},
                "systemic_impact": {"affected": True, "description": "Post-splenectomy thrombocytosis, leukocytosis.", "severity": "MODERATE"},
                "secondary_effects": {"affected": True, "description": "OPSI risk highest in first 2 years post-op.", "severity": "SEVERE"}
            },
            "functionalImpact": {
                "primary_function": "0% — complete loss of splenic immune function if total splenectomy",
                "independence": "90%",
                "compensatory_mechanisms": "Bone marrow and liver assume partial immune filtration",
                "quality_of_life": "Near-normal with vaccination and penicillin prophylaxis",
                "overallQualityOfLife": "82%"
            },
            "surgicalApproach": {
                "recommendedApproach": "Laparoscopic splenectomy or partial splenectomy if feasible",
                "mapping": {"required": False, "methods": ["Contrast CT", "Intraoperative assessment"], "reason": "Vascular hilum control"},
                "margins": {"recommended": "Complete organ or hilar control", "eloquentProximity": "Splenic hilum, tail of pancreas"}
            },
            "risks": [
                {"type": "Overwhelming post-splenectomy infection (OPSI)", "probability": "0.5–1% lifetime", "consequences": "Sepsis, DIC, death", "prevention": "Pneumococcal, meningococcal, Hib vaccines", "reversibility": "permanent risk"},
                {"type": "Pancreatic tail injury", "probability": "5–10%", "consequences": "Pancreatic fistula", "prevention": "Careful dissection of hilum", "reversibility": "manageable"},
                {"type": "Thrombosis", "probability": "5–8%", "consequences": "Portal/mesenteric vein thrombosis", "prevention": "Anticoagulation protocol", "reversibility": "potentially reversible"}
            ],
            "recoveryPrognosis": {
                "neuroplasticity": {"potential": "HIGH", "factors": ["Immune adaptation", "Vaccination compliance"], "timeline": "2–6 weeks surgical recovery"},
                "rehabilitation": {"required": True, "types": ["Vaccination course", "Penicillin prophylaxis", "Activity restriction"], "duration": "Lifelong prophylaxis", "expectedImprovement": "95% functional independence"},
                "longTermOutcome": {"bestCase": "Full QoL with compliance to vaccination protocol.", "worstCase": "OPSI event if unvaccinated.", "mostLikely": "Near-normal life with adherence to post-splenectomy guidelines."}
            },
            "recommendations": [
                "Administer pneumococcal, meningococcal ACWY, and Hib vaccines ≥2 weeks pre-op if elective.",
                "Consider partial splenectomy to preserve ≥25% functional tissue if technically feasible.",
                "Lifelong penicillin V 250mg BD prophylaxis, especially for first 2 years."
            ]
        }

    elif organ_id == "kidney":
        return {
            "removalSummary": {
                "affectedRegions": ["Renal cortex", "Glomeruli", "Collecting system"],
                "preservedRegions": ["Contralateral kidney", "Adrenal gland", "Ureter"],
                "eloquentCortex": False
            },
            "neurologicalDeficits": {
                "functional_loss": {"affected": True, "description": "GFR reduction proportional to nephron mass removed.", "severity": "MODERATE"},
                "systemic_impact": {"affected": True, "description": "Contralateral hypertrophy begins within weeks; erythropoietin, renin axis compensation.", "severity": "MILD"},
                "secondary_effects": {"affected": False, "description": "Minimal if contralateral kidney healthy.", "severity": "NONE"}
            },
            "functionalImpact": {
                "primary_function": "Contralateral kidney compensates to ~70% of baseline GFR",
                "independence": "95%",
                "compensatory_mechanisms": "Contralateral hypertrophy, increased single-nephron GFR",
                "quality_of_life": "Excellent with normal contralateral kidney",
                "overallQualityOfLife": "88%"
            },
            "surgicalApproach": {
                "recommendedApproach": "Robotic or laparoscopic partial nephrectomy if nephron-sparing possible",
                "mapping": {"required": False, "methods": ["Preoperative CT angiography", "Intraoperative ultrasound"], "reason": "Vascular control and collecting system identification"},
                "margins": {"recommended": "≥1mm negative margin", "eloquentProximity": "Renal hilum, collecting system"}
            },
            "risks": [
                {"type": "Acute kidney injury", "probability": "10–15%", "consequences": "Temporary dialysis", "prevention": "Warm ischemia <25 min, ice slush cooling", "reversibility": "potentially reversible"},
                {"type": "Urine leak", "probability": "5–10%", "consequences": "Urinoma, secondary infection", "prevention": "Watertight collecting system repair", "reversibility": "manageable"},
                {"type": "Hemorrhage", "probability": "3–8%", "consequences": "Hematoma, transfusion", "prevention": "Renorrhaphy, hemostatic agents", "reversibility": "manageable"}
            ],
            "recoveryPrognosis": {
                "neuroplasticity": {"potential": "HIGH", "factors": ["Contralateral function", f"Age {patient_age}", "Baseline creatinine"], "timeline": "4–8 weeks"},
                "rehabilitation": {"required": False, "types": ["Nephrology follow-up", "BP monitoring", "Annual GFR check"], "duration": "Lifelong monitoring", "expectedImprovement": "85%"},
                "longTermOutcome": {"bestCase": "Preserved renal function with nephron-sparing approach.", "worstCase": "CKD stage III if contralateral compensatory failure.", "mostLikely": "70–75% of baseline GFR at 1 year."}
            },
            "recommendations": [
                "Nephron-sparing surgery preferred for T1 tumors and solitary kidney.",
                "Warm ischemia time target < 25 minutes; cold ischemia if complex.",
                f"Age {patient_age}: {'excellent compensatory reserve' if patient_age < 55 else 'screen contralateral kidney pre-op, baseline creatinine essential'}."
            ]
        }

    elif organ_id == "lung":
        return {
            "removalSummary": {
                "affectedRegions": ["Pulmonary parenchyma", "Bronchopulmonary segments", "Pleural surface"],
                "preservedRegions": ["Remaining ipsilateral lobe", "Contralateral lung", "Mediastinum"],
                "eloquentCortex": False
            },
            "neurologicalDeficits": {
                "functional_loss": {"affected": True, "description": "FEV1 and DLCO reduced proportional to segments removed.", "severity": "MODERATE"},
                "systemic_impact": {"affected": True, "description": "Hypoxemia risk, increased work of breathing.", "severity": "MODERATE"},
                "secondary_effects": {"affected": True, "description": "Ipsilateral diaphragm elevation, mediastinal shift.", "severity": "MILD"}
            },
            "functionalImpact": {
                "primary_function": "Predicted post-operative FEV1 >40% required for safe resection",
                "independence": "80%",
                "compensatory_mechanisms": "Remaining lung hyperinflation and compensation",
                "quality_of_life": "Exercise-limited; dyspnea on exertion likely",
                "overallQualityOfLife": "72%"
            },
            "surgicalApproach": {
                "recommendedApproach": "Video-assisted thoracoscopic surgery (VATS) lobectomy",
                "mapping": {"required": True, "methods": ["Preoperative PFTs", "V/Q scan", "CT angiography"], "reason": "Quantify segment-specific function"},
                "margins": {"recommended": "≥2cm bronchial margin", "eloquentProximity": "Pulmonary artery, main bronchus"}
            },
            "risks": [
                {"type": "Prolonged air leak", "probability": "8–15%", "consequences": "Extended chest tube drainage", "prevention": "Tissue sealant, fissureless technique", "reversibility": "manageable"},
                {"type": "Pneumonia / respiratory failure", "probability": "5–10%", "consequences": "ICU admission, mechanical ventilation", "prevention": "Incentive spirometry, early ambulation", "reversibility": "potentially reversible"},
                {"type": "Bronchopleural fistula", "probability": "1–3%", "consequences": "Empyema, life-threatening", "prevention": "Vascularized bronchial stump coverage", "reversibility": "potentially reversible"}
            ],
            "recoveryPrognosis": {
                "neuroplasticity": {"potential": "MODERATE", "factors": ["Baseline FEV1", f"Age {patient_age}", "Smoking history"], "timeline": "3–6 months"},
                "rehabilitation": {"required": True, "types": ["Pulmonary rehabilitation", "Incentive spirometry", "Progressive exercise"], "duration": "6 months", "expectedImprovement": "70%"},
                "longTermOutcome": {"bestCase": "Return to near-normal function with pulmonary rehab.", "worstCase": "COPD exacerbation, O₂ dependency.", "mostLikely": "70–80% predicted post-op FEV1 at 6 months."}
            },
            "recommendations": [
                "Preoperative ppoFEV1 and ppoDLCO must both exceed 40% for safe resection.",
                "VATS approach preferred over open thoracotomy; reduced morbidity, faster recovery.",
                f"Patient age {patient_age}: {'good functional reserve expected' if patient_age < 65 else 'comprehensive PFT workup mandatory, cardiopulmonary exercise test recommended'}."
            ]
        }

    elif organ_id == "bone":
        return {
            "removalSummary": {
                "affectedRegions": ["Cortical shell", "Trabecular cancellous bone", "Periosteum"],
                "preservedRegions": ["Adjacent cortex", "Neurovascular bundle", "Articular cartilage"],
                "eloquentCortex": False
            },
            "neurologicalDeficits": {
                "functional_loss": {"affected": True, "description": "Structural load-bearing capacity reduced; biomechanical axis altered.", "severity": "MODERATE"},
                "systemic_impact": {"affected": True, "description": "Risk of pathological fracture if cortical integrity compromised >50%.", "severity": "MODERATE"},
                "secondary_effects": {"affected": True, "description": "Adjacent joint stress redistribution; compensatory gait changes.", "severity": "MILD"}
            },
            "functionalImpact": {
                "primary_function": "Load capacity reduced 40–60% without fixation",
                "independence": "75%",
                "compensatory_mechanisms": "Periosteal healing, cortical remodeling over 6–18 months",
                "quality_of_life": "Mobility limited; assistive device likely needed during healing",
                "overallQualityOfLife": "70%"
            },
            "surgicalApproach": {
                "recommendedApproach": "Wide local excision with cortical or intercalary reconstruction",
                "mapping": {"required": True, "methods": ["Intraoperative fluoroscopy", "Surgical navigation"], "reason": "Margin verification and implant alignment"},
                "margins": {"recommended": "Wide margin ≥5mm in all planes", "eloquentProximity": "Neurovascular bundle, joint surface"}
            },
            "risks": [
                {"type": "Pathological fracture", "probability": "15–25%", "consequences": "Non-union, hardware failure", "prevention": "Prophylactic fixation if >50% cortex involvement", "reversibility": "potentially reversible"},
                {"type": "Wound dehiscence", "probability": "8–12%", "consequences": "Deep infection, hardware exposure", "prevention": "Adequate soft tissue coverage", "reversibility": "manageable"},
                {"type": "Neurovascular injury", "probability": "3–8%", "consequences": "Permanent motor/sensory deficit", "prevention": "Navigation, neuromonitoring", "reversibility": "partial"}
            ],
            "recoveryPrognosis": {
                "neuroplasticity": {"potential": "MODERATE", "factors": ["Bone quality", f"Age {patient_age}", "Reconstruction type"], "timeline": "6–18 months"},
                "rehabilitation": {"required": True, "types": ["Physical therapy", "Weight-bearing protocol", "Assistive devices"], "duration": "12 months", "expectedImprovement": "75%"},
                "longTermOutcome": {"bestCase": "Full load-bearing with titanium reconstruction at 12 months.", "worstCase": "Hardware failure requiring revision surgery.", "mostLikely": "Functional mobility with assistive device, pain-free at 18 months."}
            },
            "recommendations": [
                "Prophylactic intramedullary fixation if cortical involvement >50% or weight-bearing bone.",
                "Intraoperative SSEP neuromonitoring for periarticular or spinal procedures.",
                f"Patient age {patient_age}: {'active bone remodeling expected' if patient_age < 50 else 'DEXA scan pre-op, consider bisphosphonates post-op'}."
            ]
        }

    else:
        # Default brain fallback (original)
        return _brain_fallback(region, hemisphere, patient_age)


def _brain_fallback(region: str, hemisphere: str, patient_age: int) -> dict:
    is_left = hemisphere == "left"
    return {
        "removalSummary": {
            "affectedRegions": [f"{hemisphere} {region}", "Adjacent white matter tracts"],
            "preservedRegions": ["Contralateral hemisphere", "Brainstem", "Cerebellum"],
            "eloquentCortex": any(x in region.lower() for x in ["frontal","temporal","parietal","motor","language"])
        },
        "neurologicalDeficits": {
            "motor":    {"affected": "frontal" in region.lower() or "motor" in region.lower(), "description": "Contralateral motor weakness predicted.", "severity": "MODERATE", "bodyParts": ["Contralateral upper extremity"]},
            "sensory":  {"affected": "parietal" in region.lower(), "description": "Somatosensory processing may be altered.", "severity": "MILD"},
            "cognitive":{"affected": True, "functions": ["Working memory","Executive function"], "description": "Cognitive deficits estimated from lesion topology.", "severity": "MODERATE"},
            "language": {"affected": is_left and any(x in region.lower() for x in ["frontal","temporal"]), "type": "expressive" if "frontal" in region.lower() else "none", "description": "Language pathways at risk.", "severity": "MODERATE" if is_left else "NONE"}
        },
        "functionalImpact": {"mobility": "Mild contralateral hemiparesis.", "independence": "70%", "communication": "Moderate impact if dominant hemisphere.", "cognition": "Executive and memory deficits projected.", "overallQualityOfLife": "68%"},
        "surgicalApproach": {
            "recommendedApproach": "awake craniotomy" if is_left else "asleep surgery",
            "mapping": {"required": True, "methods": ["Cortical stimulation mapping","fMRI"], "reason": "Proximity to eloquent cortex."},
            "margins": {"recommended": "5-10mm", "eloquentProximity": "Within 10mm"}
        },
        "risks": [
            {"type": "Permanent motor deficit", "probability": "25-35%", "consequences": "Contralateral weakness.", "prevention": "Motor mapping, staged resection", "reversibility": "potentially reversible"},
            {"type": "Seizure disorder", "probability": "20-30%", "consequences": "Post-operative epilepsy.", "prevention": "Prophylactic levetiracetam", "reversibility": "manageable with medication"},
            {"type": "Cognitive decline", "probability": "40-55%", "consequences": "Memory and executive impairment.", "prevention": "Neuropsychological baseline", "reversibility": "partially reversible"}
        ],
        "recoveryPrognosis": {
            "neuroplasticity": {"potential": "HIGH" if patient_age < 40 else "MODERATE", "factors": [f"Age {patient_age}", "Rehab intensity"], "timeline": "3-12 months"},
            "rehabilitation": {"required": True, "types": ["Physical therapy","Cognitive rehabilitation","Speech therapy"], "duration": "6-18 months", "expectedImprovement": "60-80%"},
            "longTermOutcome": {"bestCase": "Near-complete recovery with intensive rehab.", "worstCase": "Permanent moderate deficits.", "mostLikely": "Partial recovery to 70-75% function."}
        },
        "recommendations": [
            "Awake craniotomy with cortical stimulation mapping.",
            f"Patient age {patient_age}: {'favorable neuroplasticity' if patient_age < 50 else 'enhanced rehabilitation required'}.",
            "Anti-epileptic prophylaxis for 12 months post-op."
        ]
    }


generate_fallback_analysis = _fallback
