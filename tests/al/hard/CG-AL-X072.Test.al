codeunit 88825 "CG-AL-X072 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding its own rows.

    // DETERMINISM NOTE (read before re-probing or editing this oracle):
    // The starter's defect (codeunit "CG X072 Loyalty Rule VIP" assigns its
    // shared `var Eligible` parameter unconditionally instead of only
    // strengthening it) only produces an observable failure here if BC
    // dispatches "CG X072 Loyalty Rule Spend"'s subscriber BEFORE
    // "CG X072 Loyalty Rule VIP"'s on the container running this suite.
    // That dispatch order is real platform behavior BC does not guarantee.
    // Algebraically, under the flipped order (VIP fires first) an UNFIXED
    // candidate produces output IDENTICAL to the fix on every input this
    // suite exercises and passes all 7 tests - a false PASS, never a false
    // FAIL: "correct/" is order-independent by construction (both fixed
    // subscribers only ever set Eligible := true, which commutes regardless
    // of firing order), so its pass is never at risk here - only a
    // starter/candidate's fail is. Re-probe trigger fingerprint: an
    // all-green CG-AL-X072 column where failing/non-solving candidates diff
    // as no-ops against tasks/starter/CG-AL-X072/ signals dispatch order
    // flipped on that container, not that the trap stopped working.
    // Accepted residual, not caught by any test here: a buggy candidate
    // that renames or renumbers the VIP codeunit can incidentally change
    // its own subscriber-dispatch position and self-neutralize the defect
    // it was supposed to reproduce.

    local procedure Seed(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate.Insert();
    end;

    local procedure SeedApproved(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate."Priority Support Approved" := true;
        Candidate.Insert();
    end;

    local procedure ApprovedOf(No: Code[20]): Boolean
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Get(No);
        exit(Candidate."Priority Support Approved");
    end;

    [Test]
    procedure QualifyingSpendAloneIsApprovedAlongsideANonQualifyingPeer()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        Seed('C001', 'Northwind Traders', 6000, false);
        Seed('C002', 'Contoso Ltd', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C001'), 'A candidate whose spend crosses the threshold must be approved even without the VIP override');
        Assert.IsFalse(ApprovedOf('C002'), 'A candidate below the threshold and without the VIP override must stay unapproved');

        Candidate.Get('C001');
        Assert.AreEqual('Northwind Traders', Candidate."Customer Name", 'Evaluating a candidate must not change its recorded name');
        Assert.AreEqual(6000, Candidate."Lifetime Spend", 'Evaluating a candidate must not change its recorded spend');
    end;

    [Test]
    procedure VipOverrideAloneIsApprovedBelowTheThreshold()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        Seed('C010', 'Fabrikam Inc', 100, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C010'), 'A candidate with the VIP override on must be approved even below the spend threshold');
    end;

    [Test]
    procedure NeitherConditionStaysUnapproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        Seed('C020', 'Relecloud', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsFalse(ApprovedOf('C020'), 'A candidate meeting neither condition must stay unapproved');
    end;

    [Test]
    procedure BothConditionsTogetherAreApproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        Seed('C030', 'Adatum Corp', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C030'), 'A candidate meeting both conditions must be approved');
    end;

    [Test]
    procedure SpendThresholdBoundaryIsInclusive()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        Seed('C040', 'Tailspin Toys', 5000, false);
        Seed('C041', 'Wingtip Toys', 4999.99, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C040'), 'A candidate whose spend exactly reaches the threshold must be approved');
        Assert.IsFalse(ApprovedOf('C041'), 'A candidate one cent short of the threshold must stay unapproved');
    end;

    [Test]
    procedure AlreadyDecidedCandidatesAreLeftAlone()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedApproved('C050', 'Trey Research', 100, false);
        Seed('C051', 'Litware Inc', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C050'), 'A candidate already marked approved must stay approved without being reconsidered');
        Assert.IsTrue(ApprovedOf('C051'), 'A pending candidate meeting both conditions must still be approved');
    end;

    [Test]
    procedure SingleCandidateEvaluationMatchesBatchEvaluation()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        Seed('C060', 'Proseware Inc', 5500, false);
        Candidate.Get('C060');

        Gatekeeper.EvaluateCandidate(Candidate);

        Assert.IsTrue(Candidate."Priority Support Approved", 'Evaluating a single candidate directly must approve one whose spend crosses the threshold');
        Assert.IsTrue(ApprovedOf('C060'), 'The verdict from evaluating a single candidate must be persisted');
    end;
}
