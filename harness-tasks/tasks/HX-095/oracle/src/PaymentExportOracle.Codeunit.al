codeunit 87360 "HX095 Payment Export Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // Every locked (Exported or Sent) line is stored with Amount 100 and Amount (LCY) 80, the
    // values at export time (rate 1.25). The rate then moves to 1.6 and the entries applied to the
    // line sum to 130, so recomputing either amount shows: an Open line becomes 130 / 81.25.

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    begin
        HX095ReapplyOneLockedLine('01', "CGR Export Line Status"::Sent, 'S1');
    end;

    [Test]
    procedure Scenario02()
    begin
        HX095ReapplyOneLockedLine('02', "CGR Export Line Status"::Exported, 'S2');
    end;

    [Test]
    procedure Scenario03()
    var
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        OldId: Code[20];
        NewId: Code[20];
        E1: Integer;
        E2: Integer;
        OpenLine: Integer;
        SentLine: Integer;
    begin
        HX095Arrange('03', ContractNo, CurrencyCode, Frag);
        OldId := 'OLD' + Frag;
        NewId := 'NEW' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 100, OldId);
        E1 := HX095AddEntry(ContractNo, CurrencyCode, 60, '');
        E2 := HX095AddEntry(ContractNo, CurrencyCode, 70, '');
        OpenLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Open, OldId, 100, 80);
        SentLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, OldId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        HX095Apply(ContractNo, NewId, E1, E2);

        HX095AssertLine(OpenLine, NewId, 130, 81.25, 'S3 Open line');
        HX095AssertLine(SentLine, NewId, 100, 80, 'S3 Sent line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    [Test]
    procedure Scenario04()
    var
        ExportLine: Record "CGR Payment Export Line";
        ExportLineAmount: Codeunit "CGR Export Line Amount";
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        AppId: Code[20];
        SentLine: Integer;
        ExportedLine: Integer;
    begin
        HX095Arrange('04', ContractNo, CurrencyCode, Frag);
        AppId := 'APP' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 60, AppId);
        HX095AddEntry(ContractNo, CurrencyCode, 70, AppId);
        ExportedLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Exported, AppId, 100, 80);
        SentLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, AppId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        ExportLine.Get(ExportedLine);
        ExportLineAmount.UpdateAmount(ExportLine);
        Clear(ExportLine);
        ExportLine.Get(SentLine);
        ExportLineAmount.UpdateAmount(ExportLine);

        HX095AssertLine(ExportedLine, AppId, 100, 80, 'S4 Exported line');
        HX095AssertLine(SentLine, AppId, 100, 80, 'S4 Sent line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    [Test]
    procedure Scenario05()
    var
        ExportLine: Record "CGR Payment Export Line";
        ExportLineAmount: Codeunit "CGR Export Line Amount";
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        AppId: Code[20];
        OpenLine: Integer;
        SentLine: Integer;
    begin
        HX095Arrange('05', ContractNo, CurrencyCode, Frag);
        AppId := 'APP' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 60, AppId);
        HX095AddEntry(ContractNo, CurrencyCode, 70, AppId);
        OpenLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Open, AppId, 100, 80);
        SentLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, AppId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        ExportLine.Get(OpenLine);
        ExportLineAmount.UpdateAmount(ExportLine);
        Clear(ExportLine);
        ExportLine.Get(SentLine);
        ExportLineAmount.UpdateAmount(ExportLine);

        HX095AssertLine(OpenLine, AppId, 130, 81.25, 'S5 Open line');
        HX095AssertLine(SentLine, AppId, 100, 80, 'S5 Sent line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    [Test]
    procedure Scenario06()
    var
        RemittanceBuilder: Codeunit "CGR Remittance Builder";
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        AppId: Code[20];
        OpenLine: Integer;
        SentLine: Integer;
    begin
        HX095Arrange('06', ContractNo, CurrencyCode, Frag);
        AppId := 'APP' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 60, AppId);
        HX095AddEntry(ContractNo, CurrencyCode, 70, AppId);
        SentLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, AppId, 100, 80);
        OpenLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Open, AppId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        RemittanceBuilder.Rebuild(ContractNo);

        HX095AssertLine(SentLine, AppId, 100, 80, 'S6 Sent line');
        HX095AssertLine(OpenLine, AppId, 130, 81.25, 'S6 Open line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    [Test]
    procedure Scenario07()
    var
        RemittanceBuilder: Codeunit "CGR Remittance Builder";
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        AppId: Code[20];
        ExportedLine: Integer;
    begin
        HX095Arrange('07', ContractNo, CurrencyCode, Frag);
        AppId := 'APP' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 60, AppId);
        HX095AddEntry(ContractNo, CurrencyCode, 70, AppId);
        ExportedLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Exported, AppId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        RemittanceBuilder.Rebuild(ContractNo);

        HX095AssertLine(ExportedLine, AppId, 100, 80, 'S7 Exported line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    [Test]
    procedure Scenario08()
    var
        PaymentEntry: Record "CGR Customer Payment Entry";
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        OldId: Code[20];
        NewId: Code[20];
        E1: Integer;
        E2: Integer;
        LineA: Integer;
        LineB: Integer;
    begin
        HX095Arrange('08', ContractNo, CurrencyCode, Frag);
        OldId := 'OLD' + Frag;
        NewId := 'NEW' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 100, OldId);
        E1 := HX095AddEntry(ContractNo, CurrencyCode, 60, '');
        E2 := HX095AddEntry(ContractNo, CurrencyCode, 70, '');
        LineA := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, OldId, 100, 80);
        LineB := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, OldId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        HX095Apply(ContractNo, NewId, E1, E2);

        PaymentEntry.Get(E1);
        Assert.AreEqual(NewId, PaymentEntry."Applies-to ID", 'S8: first applied entry carries the new Applies-to ID');
        PaymentEntry.Get(E2);
        Assert.AreEqual(NewId, PaymentEntry."Applies-to ID", 'S8: second applied entry carries the new Applies-to ID');
        HX095AssertLine(LineA, NewId, 100, 80, 'S8 first Sent line');
        HX095AssertLine(LineB, NewId, 100, 80, 'S8 second Sent line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    [Test]
    procedure Scenario09()
    var
        PaymentApplication: Codeunit "CGR Payment Application";
        EntryNos: List of [Integer];
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        AppId: Code[20];
        OpenLine: Integer;
        SentLine: Integer;
    begin
        HX095Arrange('09', ContractNo, CurrencyCode, Frag);
        AppId := 'APP' + Frag;
        EntryNos.Add(HX095AddEntry(ContractNo, CurrencyCode, 60, AppId));
        EntryNos.Add(HX095AddEntry(ContractNo, CurrencyCode, 70, AppId));
        OpenLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Open, AppId, 130, 81.25);
        SentLine := HX095AddLine(ContractNo, CurrencyCode, "CGR Export Line Status"::Sent, AppId, 100, 80);
        EntryNos.Add(HX095AddEntry(ContractNo, CurrencyCode, 20, AppId));
        HX095SetRate(CurrencyCode, 2.0);

        PaymentApplication.ApplyEntries(ContractNo, AppId, EntryNos);

        HX095AssertLine(OpenLine, AppId, 150, 75, 'S9 Open line reapplied under the same ID');
        HX095AssertLine(SentLine, AppId, 100, 80, 'S9 Sent line');
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    local procedure HX095ReapplyOneLockedLine(Tag: Text; Status: Enum "CGR Export Line Status"; Msg: Text)
    var
        ContractNo: Code[20];
        CurrencyCode: Code[10];
        Frag: Code[8];
        OldId: Code[20];
        NewId: Code[20];
        E1: Integer;
        E2: Integer;
        LockedLine: Integer;
    begin
        HX095Arrange(Tag, ContractNo, CurrencyCode, Frag);
        OldId := 'OLD' + Frag;
        NewId := 'NEW' + Frag;
        HX095AddEntry(ContractNo, CurrencyCode, 100, OldId);
        E1 := HX095AddEntry(ContractNo, CurrencyCode, 60, '');
        E2 := HX095AddEntry(ContractNo, CurrencyCode, 70, '');
        LockedLine := HX095AddLine(ContractNo, CurrencyCode, Status, OldId, 100, 80);
        HX095SetRate(CurrencyCode, 1.6);

        HX095Apply(ContractNo, NewId, E1, E2);

        HX095AssertLine(LockedLine, NewId, 100, 80, Msg);
        HX095Cleanup(ContractNo, CurrencyCode);
    end;

    local procedure HX095Arrange(Tag: Text; var ContractNo: Code[20]; var CurrencyCode: Code[10]; var Frag: Code[8])
    var
        ExchangeRate: Record "CGR Exchange Rate";
    begin
        Frag := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 8);
        ContractNo := CopyStr('HX095-' + Tag + '-' + Frag, 1, 20);
        CurrencyCode := CopyStr('HXU' + Frag, 1, 10);

        ExchangeRate.Init();
        ExchangeRate."Currency Code" := CurrencyCode;
        ExchangeRate."Currency Factor" := 1.25;
        ExchangeRate.Insert();
    end;

    local procedure HX095AddEntry(ContractNo: Code[20]; CurrencyCode: Code[10]; Amount: Decimal; AppliesToId: Code[20]): Integer
    var
        PaymentEntry: Record "CGR Customer Payment Entry";
        EntryNo: Integer;
    begin
        EntryNo := 1;
        if PaymentEntry.FindLast() then
            EntryNo := PaymentEntry."Entry No." + 1;

        PaymentEntry.Init();
        PaymentEntry."Entry No." := EntryNo;
        PaymentEntry."Contract No." := ContractNo;
        PaymentEntry."Currency Code" := CurrencyCode;
        PaymentEntry."Remaining Amount" := Amount;
        PaymentEntry."Applies-to ID" := AppliesToId;
        PaymentEntry.Insert();
        exit(EntryNo);
    end;

    local procedure HX095AddLine(ContractNo: Code[20]; CurrencyCode: Code[10]; Status: Enum "CGR Export Line Status"; AppliesToId: Code[20]; Amount: Decimal; AmountLCY: Decimal): Integer
    var
        ExportLine: Record "CGR Payment Export Line";
        LineNo: Integer;
    begin
        LineNo := 1;
        if ExportLine.FindLast() then
            LineNo := ExportLine."Line No." + 1;

        ExportLine.Init();
        ExportLine."Line No." := LineNo;
        ExportLine."Contract No." := ContractNo;
        ExportLine.Status := Status;
        ExportLine."Applies-to ID" := AppliesToId;
        ExportLine."Currency Code" := CurrencyCode;
        ExportLine.Amount := Amount;
        ExportLine."Amount (LCY)" := AmountLCY;
        ExportLine.Insert();
        exit(LineNo);
    end;

    local procedure HX095SetRate(CurrencyCode: Code[10]; Factor: Decimal)
    var
        ExchangeRate: Record "CGR Exchange Rate";
    begin
        ExchangeRate.Get(CurrencyCode);
        ExchangeRate."Currency Factor" := Factor;
        ExchangeRate.Modify();
    end;

    local procedure HX095Apply(ContractNo: Code[20]; AppliesToId: Code[20]; E1: Integer; E2: Integer)
    var
        PaymentApplication: Codeunit "CGR Payment Application";
        EntryNos: List of [Integer];
    begin
        EntryNos.Add(E1);
        EntryNos.Add(E2);
        PaymentApplication.ApplyEntries(ContractNo, AppliesToId, EntryNos);
    end;

    local procedure HX095AssertLine(LineNo: Integer; ExpectedId: Code[20]; ExpectedAmount: Decimal; ExpectedAmountLCY: Decimal; Msg: Text)
    var
        ExportLine: Record "CGR Payment Export Line";
    begin
        ExportLine.Get(LineNo);
        Assert.AreEqual(ExpectedId, ExportLine."Applies-to ID", Msg + ': Applies-to ID');
        Assert.AreEqual(ExpectedAmount, ExportLine.Amount, Msg + ': Amount');
        Assert.AreEqual(ExpectedAmountLCY, ExportLine."Amount (LCY)", Msg + ': Amount (LCY)');
    end;

    local procedure HX095Cleanup(ContractNo: Code[20]; CurrencyCode: Code[10])
    var
        PaymentEntry: Record "CGR Customer Payment Entry";
        ExportLine: Record "CGR Payment Export Line";
        ExchangeRate: Record "CGR Exchange Rate";
    begin
        PaymentEntry.SetRange("Contract No.", ContractNo);
        PaymentEntry.DeleteAll();
        ExportLine.SetRange("Contract No.", ContractNo);
        ExportLine.DeleteAll();
        if ExchangeRate.Get(CurrencyCode) then
            ExchangeRate.Delete();
    end;
}
