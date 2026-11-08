codeunit 80503 "CGR Overdue One Night Tests"
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
        ContractNo := CheckedOutContract('HX142-NA1', 20250310D);
        Commit();
        Assert.AreEqual(1, FeeRun.ChargeOverdueFees(20250313D), 'One contract charged');
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(3, Fee.Days, 'Three days');
        Assert.AreEqual(30, Fee.Amount, 'Amount');
    end;

    [Test]
    procedure SecondNightOneDay()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare(10, 0);
        ContractNo := CheckedOutContract('HX142-NA2', 20250310D);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        FeeRun.ChargeOverdueFees(20250314D);
        Fee.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(2, Fee.Count(), 'Two entries');
        Fee.FindLast();
        Assert.AreEqual(1, Fee.Days, 'One day on the second night');
    end;

    [Test]
    procedure GraceDaysSkipped()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare(5, 2);
        ContractNo := CheckedOutContract('HX142-NA3', 20250310D);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindFirst();
        Assert.AreEqual(1, Fee.Days, 'One day after grace');
    end;

    [Test]
    procedure RefusedContractIsNotCharged()
    var
        Fee: Record "CGR Overdue Fee Entry";
        Spy: Codeunit "CGR Overdue Fee One Night Spy";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        RefusedNo: Code[20];
        OtherNo: Code[20];
        Charged: Integer;
    begin
        Prepare(10, 0);
        RefusedNo := CheckedOutContract('HX142-NA4', 20250310D);
        OtherNo := CheckedOutContract('HX142-NA5', 20250310D);
        Spy.RefuseContract(RefusedNo);
        BindSubscription(Spy);
        Commit();
        Charged := FeeRun.ChargeOverdueFees(20250313D);
        UnbindSubscription(Spy);
        Assert.AreEqual(1, Charged, 'Only the other contract is charged');
        Fee.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(0, Fee.Count(), 'No entry for the refused contract');
        Fee.SetRange("Contract No.", OtherNo);
        Assert.AreEqual(1, Fee.Count(), 'The other contract is charged');
    end;

    [Test]
    procedure NewRateAfterReload()
    var
        Fee: Record "CGR Overdue Fee Entry";
        FeeRun: Codeunit "CGR Overdue Fee Run";
        ContractNo: Code[20];
    begin
        Prepare(3, 0);
        ContractNo := CheckedOutContract('HX142-NA6', 20250310D);
        Commit();
        FeeRun.ChargeOverdueFees(20250313D);
        WriteSettings(7.25, 0);
        Commit();
        FeeRun.ChargeOverdueFees(20250314D);
        Fee.SetRange("Contract No.", ContractNo);
        Fee.FindLast();
        Assert.AreEqual(7.25, Fee.Amount, 'New rate applies');
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
