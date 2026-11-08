codeunit 88135 "HX145 Rerate Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        MissingVehicleTxt: Label 'The CGR Vehicle does not exist. Identification fields and values: No.=''HX145-VX''', Locked = true;

    [Test]
    procedure BranchRerateRoundsToCents()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedTwoBranchesHX145();
        Commit();

        Runner.SetHX145Branch('HX145A', 1.05);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Re-rating branch HX145A succeeds: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX145Changed(), 'Two Open contracts of branch HX145A are changed');
        Assert.AreEqual(52.40, RateHX145('HX145-C1'), '49.90 x 1.05 rounded to 0.01');
        Assert.AreEqual(34.97, RateHX145('HX145-C2'), '33.30 x 1.05 rounded to 0.01');
        Assert.AreEqual(49.90, RateHX145('HX145-C3'), 'A contract that is not Open keeps its rate');
        Assert.AreEqual(21.70, RateHX145('HX145-C4'), 'A contract of another branch keeps its rate');
    end;

    [Test]
    procedure BranchRerateQueuesOnlyRatesChanged()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedTwoBranchesHX145();
        Commit();

        Runner.SetHX145Branch('HX145A', 1.05);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Re-rating branch HX145A succeeds: ' + GetLastErrorText());
        Assert.AreEqual(0, CountHX145('contractChanged', 'HX145-*'), 'Re-rating a branch queues no contractChanged notification');
        Assert.AreEqual(1, CountHX145('ratesChanged', 'HX145A'), 'Re-rating queues one ratesChanged notification for the branch');
        Assert.AreEqual(0, CountHX145('ratesChanged', 'HX145B'), 'No ratesChanged notification for a branch that was not re-rated');
    end;

    [Test]
    procedure NightRerateRoundsEveryBranch()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedTwoBranchesHX145();
        Commit();

        Runner.SetHX145Night(1.05);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The night job re-rates every branch: ' + GetLastErrorText());
        Assert.AreEqual(3, Runner.HX145Changed(), 'Three Open contracts across both branches are changed');
        Assert.AreEqual(52.40, RateHX145('HX145-C1'), '49.90 x 1.05 rounded to 0.01');
        Assert.AreEqual(34.97, RateHX145('HX145-C2'), '33.30 x 1.05 rounded to 0.01');
        Assert.AreEqual(22.79, RateHX145('HX145-C4'), '21.70 x 1.05 rounded to 0.01');
        Assert.AreEqual(49.90, RateHX145('HX145-C3'), 'A contract that is not Open keeps its rate');
        Assert.AreEqual(49.90, RateHX145('HX145-C9'), 'A contract of no branch keeps its rate');
    end;

    [Test]
    procedure NightRerateQueuesNoContractChanged()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedTwoBranchesHX145();
        Commit();

        Runner.SetHX145Night(1.05);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The night job re-rates every branch: ' + GetLastErrorText());
        Assert.AreEqual(0, CountHX145('contractChanged', 'HX145-*'), 'The night job queues no contractChanged notification');
        Assert.AreEqual(1, CountHX145('ratesChanged', 'HX145A'), 'One ratesChanged notification for branch HX145A');
        Assert.AreEqual(1, CountHX145('ratesChanged', 'HX145B'), 'One ratesChanged notification for branch HX145B');
    end;

    [Test]
    procedure PlainContractChangeQueuesNotification()
    begin
        InitHX145();
        SeedTwoBranchesHX145();
        Commit();

        ChangeContractHX145('HX145-C9');

        Assert.AreEqual(1, CountHX145('contractChanged', 'HX145-C9'), 'A contract change queues its contractChanged notification');
    end;

    [Test]
    procedure ContractChangeQueuesAfterNightRerate()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedTwoBranchesHX145();
        Commit();

        Runner.SetHX145Night(1.05);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The night job re-rates every branch: ' + GetLastErrorText());

        ChangeContractHX145('HX145-C9');

        Assert.AreEqual(1, CountHX145('contractChanged', 'HX145-C9'), 'After the night job a contract change queues its contractChanged notification');
    end;

    [Test]
    procedure ContractChangeQueuesAfterFailedNight()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedMissingVehicleHX145();
        Commit();

        Runner.SetHX145Night(1.05);
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'The night job stops on a contract whose vehicle no longer exists');
        Assert.AreEqual(MissingVehicleTxt, GetLastErrorText(), 'The night job stops with the usual does-not-exist error');

        ChangeContractHX145('HX145-C9');

        Assert.AreEqual(1, CountHX145('contractChanged', 'HX145-C9'), 'After a failed night job a contract change queues its contractChanged notification');
    end;

    [Test]
    procedure NightRerateRunsAgainAfterFailure()
    var
        Runner: Codeunit "HX145 Rerate Runner";
        Ok: Boolean;
    begin
        InitHX145();
        SeedMissingVehicleHX145();
        Commit();

        Runner.SetHX145Night(1.05);
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'The night job stops on a contract whose vehicle no longer exists');

        InsertVehicleHX145('HX145-VX', 49.90);
        Commit();
        Runner.SetHX145Night(1.05);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The night job runs again in the same session once the vehicle exists: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.HX145Changed(), 'The second night job changes the Open contract of branch HX145F');
        Assert.AreEqual(52.40, RateHX145('HX145-F1'), '49.90 x 1.05 rounded to 0.01');
        Assert.AreEqual(0, CountHX145('contractChanged', 'HX145-F1'), 'The second night job queues no contractChanged notification');
    end;

    local procedure InitHX145()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Branch: Record "CGR Branch";
        Notification: Record "CGR Partner Notification";
    begin
        WorkDate(20250310D);
        Contract.SetFilter("No.", 'HX145-*');
        Contract.DeleteAll();
        Vehicle.SetFilter("No.", 'HX145-*');
        Vehicle.DeleteAll();
        Branch.SetFilter(Code, 'HX145*');
        Branch.DeleteAll();
        Notification.SetFilter(Payload, 'HX145*');
        Notification.DeleteAll();
        Commit();
    end;

    local procedure SeedTwoBranchesHX145()
    begin
        InsertBranchHX145('HX145A');
        InsertBranchHX145('HX145B');
        InsertVehicleHX145('HX145-V1', 49.90);
        InsertVehicleHX145('HX145-V2', 33.30);
        InsertVehicleHX145('HX145-V3', 21.70);
        InsertContractHX145('HX145-C1', 'HX145A', 'HX145-V1', "CGR Rental Status"::Open, 49.90);
        InsertContractHX145('HX145-C2', 'HX145A', 'HX145-V2', "CGR Rental Status"::Open, 33.30);
        InsertContractHX145('HX145-C3', 'HX145A', 'HX145-V1', "CGR Rental Status"::"Checked Out", 49.90);
        InsertContractHX145('HX145-C4', 'HX145B', 'HX145-V3', "CGR Rental Status"::Open, 21.70);
        InsertContractHX145('HX145-C9', '', 'HX145-V1', "CGR Rental Status"::Open, 49.90);
    end;

    local procedure SeedMissingVehicleHX145()
    begin
        InsertBranchHX145('HX145F');
        InsertVehicleHX145('HX145-V1', 49.90);
        InsertContractHX145('HX145-F1', 'HX145F', 'HX145-VX', "CGR Rental Status"::Open, 49.90);
        InsertContractHX145('HX145-C9', '', 'HX145-V1', "CGR Rental Status"::Open, 49.90);
    end;

    local procedure InsertBranchHX145(BranchCode: Code[10])
    var
        Branch: Record "CGR Branch";
    begin
        Branch.Init();
        Branch.Code := BranchCode;
        Branch.Name := 'HX145 branch ' + BranchCode;
        Branch.Insert();
    end;

    local procedure InsertVehicleHX145(VehicleNo: Code[20]; DailyRate: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Description := 'HX145 vehicle';
        Vehicle.Insert();
    end;

    local procedure InsertContractHX145(ContractNo: Code[20]; BranchCode: Code[10]; VehicleNo: Code[20]; Status: Enum "CGR Rental Status"; Rate: Decimal)
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Branch Code" := BranchCode;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX145 Customer';
        Contract."Start Date" := 20250301D;
        Contract."End Date" := 20250331D;
        Contract.Status := Status;
        Contract."Agreed Daily Rate" := Rate;
        Contract.Insert();
    end;

    local procedure ChangeContractHX145(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Contract."Customer Name" := 'HX145 Customer changed';
        Contract.Modify(true);
    end;

    local procedure RateHX145(ContractNo: Code[20]): Decimal
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        exit(Contract."Agreed Daily Rate");
    end;

    local procedure CountHX145(EventType: Text[30]; PayloadFilter: Text): Integer
    var
        Notification: Record "CGR Partner Notification";
    begin
        Notification.SetRange("Event Type", EventType);
        Notification.SetFilter(Payload, PayloadFilter);
        exit(Notification.Count());
    end;
}
