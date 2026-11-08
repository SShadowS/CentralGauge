codeunit 80507 "CGR Overdue Fee Single Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ChargesThreeDays()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare(10, 0);
        ContractNo := CheckedOutContract('HX142-NC1', 20250310D);
        Commit();
        Assert.AreEqual(1, FeeRun.ChargeOverdueFees(20250313D), 'One contract charged');
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(3, Fee.Days, 'Three days');
        Assert.AreEqual(30, Fee.Amount, 'Amount');
    end;

    [Test]
    procedure GraceDaysSkipped()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare(5, 2);
        ContractNo := CheckedOutContract('HX142-NC2', 20250310D);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(1, Fee.Days, 'One day after grace');
    end;

    [Test]
    procedure RefusedContractKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        Fee: Record "CGR Overdue Fee Entry";
        Spy: Codeunit "CGR Overdue Fee Single Spy";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        RefusedNo: Code[20];
        OtherNo: Code[20];
    begin
        Prepare(10, 0);
        RefusedNo := CheckedOutContract('HX142-NC3', 20250310D);
        OtherNo := CheckedOutContract('HX142-NC4', 20250310D);
        Spy.RefuseContract(RefusedNo);
        BindSubscription(Spy);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        UnbindSubscription(Spy);
        Fee.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(0, Fee.Count(), 'No entry for the refused contract');
        Contract.Get(RefusedNo);
        Assert.AreEqual(0D, Contract."Fees Charged Through", 'Refused contract unchanged');
        Fee.SetRange("Contract No.", OtherNo);
        Assert.AreEqual(1, Fee.Count(), 'The other contract is charged');
    end;

    [Test]
    procedure RateAfterReloadApplies()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare(3, 0);
        ContractNo := CheckedOutContract('HX142-NC5', 20250310D);
        WriteSettings(7.25, 0);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(21.75, Fee.Amount, '3 days x the reloaded rate');
    end;

    local procedure Prepare(FeePerDay: Decimal; GraceDays: Integer)
    var
        Contract: Record "CGR Rental Contract";
    begin
        WorkDate(20250313D);
        Contract.SetRange(Status, Contract.Status::"Checked Out");
        Contract.DeleteAll();
        WriteSettings(FeePerDay, GraceDays);
    end;

    local procedure WriteSettings(FeePerDay: Decimal; GraceDays: Integer)
    var
        Setup: Record "CGR Setup";
        Settings: Codeunit "CGR Overdue Fee Settings";
    begin
        Setup.GetOrCreate();
        Setup."Overdue Fee per Day" := FeePerDay;
        Setup."Overdue Grace Days" := GraceDays;
        Setup.Modify();
        Settings.Reload();
    end;

    local procedure CheckedOutContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX142 Naive', EndDate - 3, EndDate);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;
}
