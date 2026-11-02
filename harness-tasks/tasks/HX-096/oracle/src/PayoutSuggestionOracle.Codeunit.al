codeunit 87380 "HX096 Payout Suggestion Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // Cutoff 31 May 2027. Every statement is due 15 May 2027 for 1000.55. A share is due 20 May
    // 2027 unless a scenario says it is due after the cutoff (30 June 2027). Setup is committed and
    // every To Be Paid change runs in its own runner codeunit, re-read with Get afterwards.

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    begin
        HX096Reset(96001);
        HX096AddStatement(96001);
        HX096AddShare(96001, 1, 200.30, false, true, true);
        Commit();
        HX096Suggest();
        HX096AssertMain(96001, 800.25, false, 1, 'S1');
        HX096Reset(96001);
    end;

    [Test]
    procedure Scenario02()
    begin
        HX096Reset(96002);
        HX096AddStatement(96002);
        HX096AddShare(96002, 1, 100.00, false, false, false);
        HX096AddShare(96002, 2, 150.40, false, true, true);
        Commit();
        HX096Suggest();
        HX096AssertMain(96002, 850.15, false, 1, 'S2');
        HX096Reset(96002);
    end;

    [Test]
    procedure Scenario03()
    begin
        HX096Reset(96003);
        HX096AddHeldAndLateShare(96003);
        Commit();
        HX096Suggest();
        HX096AssertMain(96003, 800.00, true, 1, 'S3');
        HX096Reset(96003);
    end;

    [Test]
    procedure Scenario04()
    var
        PayoutLine: Record "CGR Payout Line";
    begin
        HX096Reset(96004);
        HX096AddHeldShare(96004);
        Commit();
        HX096Suggest();
        HX096AssertMain(96004, 800.25, false, 1, 'S4');

        HX096Expect(96004, 0, true, false, 'S4 on');
        HX096Expect(96004, 0, false, true, 'S4 off');

        // The refusal depends on the shares, not on the amount left on the line.
        HX096GetLine(96004, 0, PayoutLine);
        PayoutLine.Amount := 1000.55;
        PayoutLine.Modify();
        Commit();
        HX096Expect(96004, 0, true, false, 'S4 full amount on');
        HX096Reset(96004);
    end;

    [Test]
    procedure Scenario05()
    begin
        HX096Reset(96005);
        HX096AddHeldAndDueShare(96005);
        Commit();
        HX096Suggest();
        HX096AssertMain(96005, 750.10, true, 2, 'S5');
        HX096AssertShare(96005, 2, 50.15, true, 'S5');
        HX096Reset(96005);
    end;

    [Test]
    procedure Scenario06()
    var
        Share: Record "CGR Third-Party Share";
    begin
        HX096Reset(96006);
        HX096Reset(96016);
        HX096AddHeldAndDueShare(96006);
        HX096AddHeldShare(96016);
        Commit();
        HX096Suggest();
        HX096AssertMain(96006, 750.10, true, 2, 'S6 A');
        HX096AssertShare(96006, 2, 50.15, true, 'S6 A');
        HX096AssertMain(96016, 800.25, false, 1, 'S6 B');

        // The paid share is put on hold after the proposal: its own line still switches freely,
        // while the owner line, payable at proposal time, is now held by the current shares.
        Share.Get(96006, 2);
        Share."On Hold" := true;
        Share.Modify();
        Commit();
        HX096Expect(96006, 2, false, true, 'S6 A share off');
        HX096Expect(96006, 2, true, true, 'S6 A share on');
        HX096Expect(96006, 0, false, true, 'S6 A owner off');
        HX096Expect(96006, 0, true, false, 'S6 A owner on');

        HX096Expect(96016, 0, true, false, 'S6 B on');
        HX096Reset(96006);
        HX096Reset(96016);
    end;

    [Test]
    procedure Scenario07()
    begin
        HX096Reset(96007);
        HX096Reset(96017);
        HX096AddStatement(96007);
        HX096AddHeldShare(96017);
        Commit();
        HX096Suggest();
        HX096AssertMain(96007, 1000.55, true, 1, 'S7 A');
        HX096AssertMain(96017, 800.25, false, 1, 'S7 B');
        HX096Reset(96007);
        HX096Reset(96017);
    end;

    [Test]
    procedure Scenario08()
    var
        Share: Record "CGR Third-Party Share";
    begin
        HX096Reset(96008);
        HX096Reset(96018);
        HX096AddHeldShare(96008);
        HX096AddHeldShare(96018);
        Commit();
        HX096Suggest();
        HX096AssertMain(96008, 800.25, false, 1, 'S8 A');
        HX096AssertMain(96018, 800.25, false, 1, 'S8 B');

        Share.Get(96008, 1);
        Share."On Hold" := false;
        Share.Modify();
        Commit();
        HX096Expect(96008, 0, true, true, 'S8 A released on');

        HX096Expect(96018, 0, true, false, 'S8 B on');
        HX096Reset(96008);
        HX096Reset(96018);
    end;

    [Test]
    procedure Scenario09()
    begin
        HX096Reset(96009);
        HX096Reset(96019);
        HX096AddHeldAndLateShare(96009);
        HX096AddHeldShare(96019);
        Commit();
        HX096Suggest();
        HX096AssertMain(96009, 800.00, true, 1, 'S9 A');
        HX096AssertMain(96019, 800.25, false, 1, 'S9 B');

        HX096Expect(96009, 0, false, true, 'S9 A off');
        HX096Expect(96009, 0, true, true, 'S9 A on');

        HX096Expect(96019, 0, true, false, 'S9 B on');
        HX096Reset(96009);
        HX096Reset(96019);
    end;

    local procedure HX096AddHeldShare(EntryNo: Integer)
    begin
        HX096AddStatement(EntryNo);
        HX096AddShare(EntryNo, 1, 200.30, false, true, true);
    end;

    local procedure HX096AddHeldAndDueShare(EntryNo: Integer)
    begin
        HX096AddStatement(EntryNo);
        HX096AddShare(EntryNo, 1, 200.30, false, true, true);
        HX096AddShare(EntryNo, 2, 50.15, false, true, false);
    end;

    local procedure HX096AddHeldAndLateShare(EntryNo: Integer)
    begin
        HX096AddStatement(EntryNo);
        HX096AddShare(EntryNo, 1, 150.40, false, true, true);
        HX096AddShare(EntryNo, 2, 50.15, true, true, false);
    end;

    local procedure HX096AddStatement(EntryNo: Integer)
    var
        StatementLine: Record "CGR Owner Statement Line";
    begin
        StatementLine.Init();
        StatementLine."Entry No." := EntryNo;
        StatementLine."Owner Code" := 'OWN4410';
        StatementLine."Vehicle No." := 'V-HX096';
        StatementLine."Due Date" := DMY2Date(15, 5, 2027);
        StatementLine.Amount := 1000.55;
        StatementLine.Open := true;
        StatementLine.Insert();
    end;

    local procedure HX096AddShare(EntryNo: Integer; LineNo: Integer; ShareAmount: Decimal; AfterCutoff: Boolean; IsOpen: Boolean; OnHold: Boolean)
    var
        Share: Record "CGR Third-Party Share";
    begin
        Share.Init();
        Share."Statement Entry No." := EntryNo;
        Share."Line No." := LineNo;
        Share."Payee Code" := 'BANK01';
        if AfterCutoff then
            Share."Due Date" := DMY2Date(30, 6, 2027)
        else
            Share."Due Date" := DMY2Date(20, 5, 2027);
        Share.Amount := ShareAmount;
        Share.Open := IsOpen;
        Share."On Hold" := OnHold;
        Share.Insert();
    end;

    local procedure HX096Suggest()
    var
        PayoutSuggestion: Codeunit "CGR Payout Suggestion";
    begin
        PayoutSuggestion.Suggest(DMY2Date(31, 5, 2027));
        Commit();
    end;

    local procedure HX096AssertMain(EntryNo: Integer; ExpectedAmount: Decimal; ExpectedToBePaid: Boolean; ExpectedLines: Integer; Tag: Text)
    var
        PayoutLine: Record "CGR Payout Line";
    begin
        PayoutLine.SetRange("Statement Entry No.", EntryNo);
        Assert.AreEqual(ExpectedLines, PayoutLine.Count(), Tag + ': payout lines of the statement');
        HX096GetLine(EntryNo, 0, PayoutLine);
        Assert.AreEqual(ExpectedAmount, PayoutLine.Amount, Tag + ': owner payout amount');
        Assert.AreEqual(ExpectedToBePaid, PayoutLine."To Be Paid", Tag + ': owner To Be Paid');
    end;

    local procedure HX096AssertShare(EntryNo: Integer; ShareLineNo: Integer; ExpectedAmount: Decimal; ExpectedToBePaid: Boolean; Tag: Text)
    var
        PayoutLine: Record "CGR Payout Line";
    begin
        HX096GetLine(EntryNo, ShareLineNo, PayoutLine);
        Assert.AreEqual(ExpectedAmount, PayoutLine.Amount, Tag + ': share payout amount');
        Assert.AreEqual(ExpectedToBePaid, PayoutLine."To Be Paid", Tag + ': share To Be Paid');
    end;

    local procedure HX096GetLine(EntryNo: Integer; ShareLineNo: Integer; var PayoutLine: Record "CGR Payout Line")
    begin
        Clear(PayoutLine);
        PayoutLine.SetRange("Statement Entry No.", EntryNo);
        PayoutLine.SetRange("Share Line No.", ShareLineNo);
        Assert.IsTrue(PayoutLine.FindFirst(), StrSubstNo('Payout line %1/%2 should exist', EntryNo, ShareLineNo));
    end;

    local procedure HX096AssertStored(EntryNo: Integer; ShareLineNo: Integer; ExpectedToBePaid: Boolean; Tag: Text)
    var
        PayoutLine: Record "CGR Payout Line";
    begin
        HX096GetLine(EntryNo, ShareLineNo, PayoutLine);
        Assert.AreEqual(ExpectedToBePaid, PayoutLine."To Be Paid", Tag + ': stored To Be Paid');
    end;

    // Validates and stores NewValue through a runner codeunit, so a wrong refusal and a missing
    // refusal both lose an assertion. A refused change leaves the stored value as it was.
    local procedure HX096Expect(EntryNo: Integer; ShareLineNo: Integer; NewValue: Boolean; Accepted: Boolean; Tag: Text)
    var
        PayoutLine: Record "CGR Payout Line";
        StoredBefore: Boolean;
        Ok: Boolean;
    begin
        HX096GetLine(EntryNo, ShareLineNo, PayoutLine);
        StoredBefore := PayoutLine."To Be Paid";
        Commit();
        if NewValue then
            Ok := Codeunit.Run(Codeunit::"HX096 Set To Be Paid", PayoutLine)
        else
            Ok := Codeunit.Run(Codeunit::"HX096 Clear To Be Paid", PayoutLine);
        if Accepted then begin
            Assert.IsTrue(Ok, Tag + ': change should be accepted: ' + GetLastErrorText());
            HX096AssertStored(EntryNo, ShareLineNo, NewValue, Tag);
        end else begin
            Assert.IsFalse(Ok, Tag + ': change should be refused');
            HX096AssertStored(EntryNo, ShareLineNo, StoredBefore, Tag);
        end;
    end;

    local procedure HX096Reset(EntryNo: Integer)
    var
        StatementLine: Record "CGR Owner Statement Line";
        Share: Record "CGR Third-Party Share";
        PayoutLine: Record "CGR Payout Line";
    begin
        StatementLine.SetRange("Entry No.", EntryNo);
        StatementLine.DeleteAll();
        Share.SetRange("Statement Entry No.", EntryNo);
        Share.DeleteAll();
        PayoutLine.SetRange("Statement Entry No.", EntryNo);
        PayoutLine.DeleteAll();
        Commit();
    end;
}
