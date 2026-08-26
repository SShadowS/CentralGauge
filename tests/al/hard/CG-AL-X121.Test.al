codeunit 89315 "CG-AL-X121 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own contracts. Contract numbers are unique per
    // test regardless, but the tables are still cleared up front per the
    // house convention.

    local procedure CreateContract(var Header: Record "CG X121 Contract Header"; No: Code[20]; PlanCode: Code[10]; RegionCode: Code[10]; ContactName: Text[50])
    var
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.Init();
        Header."No." := No;
        Header."Plan Code" := PlanCode;
        Header."Region Code" := RegionCode;
        Header."Contact Name" := ContactName;
        Header.Insert();
        ContractMgt.GenerateInitialLines(Header);
    end;

    local procedure AssertAllLinesHaveAmount(ContractNo: Code[20]; ExpectedAmount: Decimal; Msg: Text)
    var
        Line: Record "CG X121 Contract Line";
        LineCount: Integer;
    begin
        Line.SetRange("Contract No.", ContractNo);
        if Line.FindSet() then
            repeat
                Assert.AreEqual(ExpectedAmount, Line.Amount, Msg);
                LineCount += 1;
            until Line.Next() = 0;
        Assert.AreEqual(3, LineCount, 'Expected exactly three billing lines for the contract');
    end;

    [Test]
    procedure PlanCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        CreateContract(Header, 'C001', 'BASIC', 'EAST', 'Alice');

        Header.Validate("Plan Code", 'PLUS');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C001');

        AssertAllLinesHaveAmount('C001', 200, 'Billing lines must reflect the new plan after the lines are refreshed');
        Assert.AreEqual(6, Header."Last Line Entry No.", 'Refreshing the billing lines after a plan change must rebuild them, not just adjust their amounts in place');

        Line.SetRange("Contract No.", 'C001');
        Assert.IsTrue(Line.FindSet(), 'The contract must still have billing lines after the plan change');
        Assert.AreEqual(1, Line."Period No.", 'The first billing line must keep its position in the billing schedule after the lines are refreshed');
        Line.FindLast();
        Assert.AreEqual(3, Line."Period No.", 'The third billing line must keep its position in the billing schedule after the lines are refreshed');
    end;

    [Test]
    procedure RegionCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        CreateContract(Header, 'C002', 'BASIC', 'EAST', 'Bob');

        Header.Validate("Region Code", 'WEST');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C002');

        AssertAllLinesHaveAmount('C002', 110, 'Billing lines must reflect the new region after the lines are refreshed');
    end;

    [Test]
    procedure ContactNameChangeDoesNotRebuildLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        CreateContract(Header, 'C003', 'BASIC', 'EAST', 'Carol');

        Assert.IsTrue(Line.Get('C003', 1), 'Billing line 1 for the contract must exist right after it is created');
        Line.Amount := 777;
        Line.Modify();

        Header.Validate("Contact Name", 'Caroline');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C003');

        Assert.AreEqual(3, Header."Last Line Entry No.", 'The billing lines must not be rebuilt when only the contact name changes');

        Assert.IsTrue(Line.Get('C003', 1), 'Billing line 1 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(777, Line.Amount, 'A billing line''s recorded amount must survive when only the contact name changes');
        Assert.IsTrue(Line.Get('C003', 2), 'Billing line 2 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(100, Line.Amount, 'The second billing line must be untouched when only the contact name changes');
        Assert.IsTrue(Line.Get('C003', 3), 'Billing line 3 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(100, Line.Amount, 'The third billing line must be untouched when only the contact name changes');
    end;

    [Test]
    procedure PlanCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        CreateContract(HeaderA, 'C004A', 'BASIC', 'EAST', 'Dave');
        CreateContract(HeaderB, 'C004B', 'PLUS', 'NORTH', 'Erin');

        HeaderA.Validate("Plan Code", 'PREMIUM');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C004B');

        AssertAllLinesHaveAmount('C004A', 300, 'Billing lines for the edited contract must reflect its new plan');
        AssertAllLinesHaveAmount('C004B', 240, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure RegionCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        CreateContract(HeaderA, 'C005A', 'PLUS', 'EAST', 'Frank');
        CreateContract(HeaderB, 'C005B', 'PLUS', 'WEST', 'Grace');

        HeaderA.Validate("Region Code", 'NORTH');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C005B');

        AssertAllLinesHaveAmount('C005A', 240, 'Billing lines for the edited contract must reflect its new region');
        AssertAllLinesHaveAmount('C005B', 220, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure PricingFormulaAppliesAcrossPlanAndRegionCodes()
    var
        Header: Record "CG X121 Contract Header";
        PlanHeader: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
        RegionCodes: List of [Code[10]];
        ExpectedRegionFactors: List of [Decimal];
        PlanCodes: List of [Code[10]];
        ExpectedPlanRates: List of [Decimal];
        Index: Integer;
    begin
        Header.DeleteAll();
        Line.DeleteAll();

        RegionCodes.Add('WEST');
        RegionCodes.Add('NORTH');
        RegionCodes.Add('EAST');
        RegionCodes.Add('SOUTH');
        ExpectedRegionFactors.Add(1.1);
        ExpectedRegionFactors.Add(1.2);
        ExpectedRegionFactors.Add(1.0);
        ExpectedRegionFactors.Add(1.0);

        CreateContract(Header, 'C006', 'PLUS', 'EAST', 'Holly');

        for Index := 1 to RegionCodes.Count() do begin
            Header.Get('C006');
            Header.Validate("Region Code", RegionCodes.Get(Index));
            Header.Modify();
            ContractMgt.RefreshLines(Header);
            AssertAllLinesHaveAmount('C006', 200 * ExpectedRegionFactors.Get(Index), 'Billing lines must reflect the region currently on the header');
        end;

        PlanCodes.Add('GOLD');
        ExpectedPlanRates.Add(100);

        CreateContract(PlanHeader, 'C007', 'BASIC', 'EAST', 'Ivan');

        for Index := 1 to PlanCodes.Count() do begin
            PlanHeader.Get('C007');
            PlanHeader.Validate("Plan Code", PlanCodes.Get(Index));
            PlanHeader.Modify();
            ContractMgt.RefreshLines(PlanHeader);
            AssertAllLinesHaveAmount('C007', ExpectedPlanRates.Get(Index) * 1.0, 'Billing lines must reflect the plan currently on the header');
        end;
    end;
}
