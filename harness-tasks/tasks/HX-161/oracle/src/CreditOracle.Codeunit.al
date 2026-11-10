codeunit 88375 "HX161 Credit Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        GoodCustomerTxt: Label 'HX161 Good Customer', Locked = true;
        RefusedCustomerTxt: Label 'HX161 Refused Customer', Locked = true;
        DownCustomerTxt: Label 'HX161 Down Customer', Locked = true;
        LateTimeoutCustomerTxt: Label 'HX161 Late Timeout Customer', Locked = true;

    [Test]
    procedure AgencyApprovalGivesTrue()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCheckHX161(GoodCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'CheckCustomer does not raise: ' + GetLastErrorText());
        Assert.IsTrue(Runner.ResultHX161(), 'CheckCustomer is true when the agency approves the customer');
    end;

    [Test]
    procedure AgencyRefusalGivesFalse()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCheckHX161(RefusedCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'CheckCustomer does not raise: ' + GetLastErrorText());
        Assert.IsFalse(Runner.ResultHX161(), 'CheckCustomer is false when the agency refuses the customer');
    end;

    [Test]
    procedure AgencyErrorGivesFalseWithoutRaising()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCheckHX161(DownCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'CheckCustomer never raises the agency error to its caller: ' + GetLastErrorText());
        Assert.IsFalse(Runner.ResultHX161(), 'CheckCustomer is false when the agency raises an error');
    end;

    [Test]
    procedure AgencyTimeoutAfterApprovalGivesFalse()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCheckHX161(LateTimeoutCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'CheckCustomer never raises the agency error to its caller: ' + GetLastErrorText());
        Assert.IsFalse(Runner.ResultHX161(), 'CheckCustomer is false when the agency raises an error, whatever it answered first');
    end;

    [Test]
    procedure NoAgencyAnswerGivesFalse()
    var
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();

        Runner.SetCheckHX161(GoodCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'CheckCustomer does not raise: ' + GetLastErrorText());
        Assert.IsFalse(Runner.ResultHX161(), 'CheckCustomer is true only when the agency approves, and no agency answered');
    end;

    [Test]
    procedure DeskContractRecordsApproval()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCreateHX161(GoodCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Creating a contract never fails because of the credit check: ' + GetLastErrorText());
        AssertContractHX161(Runner.ContractNoHX161(), GoodCustomerTxt, true);
    end;

    [Test]
    procedure DeskContractRecordsRefusal()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCreateHX161(RefusedCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Creating a contract never fails because of the credit check: ' + GetLastErrorText());
        AssertContractHX161(Runner.ContractNoHX161(), RefusedCustomerTxt, false);
    end;

    [Test]
    procedure AgencyDownStillCreatesContract()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCreateHX161(DownCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'An agency error does not fail the contract: ' + GetLastErrorText());
        AssertContractHX161(Runner.ContractNoHX161(), DownCustomerTxt, false);
    end;

    [Test]
    procedure ContractInCallerTransactionRecordsApproval()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCallerRowHX161(GoodCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'CreateContract works inside the caller''s own transaction: ' + GetLastErrorText());
        AssertContractHX161(Runner.ContractNoHX161(), GoodCustomerTxt, true);
        Assert.IsTrue(CallerRowExistsHX161(), 'The caller''s row of the same transaction is kept');
    end;

    [Test]
    procedure CallerFailureRollsBackContractAndRow()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Contract: Record "CGR Rental Contract";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCallerFailsHX161(GoodCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The caller''s later error fails its transaction');
        Assert.AreEqual('HX161 import failed after an approved contract', GetLastErrorText(), 'The contract was created with the approval and the caller''s own error is the one raised');
        Assert.IsFalse(CallerRowExistsHX161(), 'The caller''s row is rolled back with its transaction');
        Contract.SetRange("Customer Name", GoodCustomerTxt);
        Assert.AreEqual(0, Contract.Count(), 'The contract is rolled back with the caller''s transaction');
    end;

    [Test]
    procedure AgencyDownInCallerTransactionKeepsRow()
    var
        Spy: Codeunit "HX161 Agency Spy";
        Runner: Codeunit "HX161 Create Runner";
        Ok: Boolean;
    begin
        InitHX161();
        BindSubscription(Spy);

        Runner.SetCallerRowHX161(DownCustomerTxt);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'An agency error does not fail the caller''s transaction: ' + GetLastErrorText());
        AssertContractHX161(Runner.ContractNoHX161(), DownCustomerTxt, false);
        Assert.IsTrue(CallerRowExistsHX161(), 'The caller''s row of the same transaction is kept');
    end;

    local procedure InitHX161()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
    begin
        WorkDate(20250301D);
        Contract.SetFilter("No.", 'RC9161*');
        Contract.DeleteAll();
        Contract.Reset();
        Contract.SetFilter("Customer Name", 'HX161*');
        Contract.DeleteAll();
        Vehicle.SetFilter("No.", 'HX161-*');
        Vehicle.DeleteAll();
        Vehicle.Reset();
        Vehicle.Init();
        Vehicle."No." := 'HX161-V1';
        Vehicle.Insert();
        Setup.GetOrCreate();
        Setup."Last Contract No." := 916100;
        Setup.Modify();
        Commit();
    end;

    local procedure AssertContractHX161(ContractNo: Code[20]; CustomerName: Text[100]; CreditApproved: Boolean)
    var
        Contract: Record "CGR Rental Contract";
    begin
        Assert.IsTrue(Contract.Get(ContractNo), 'The contract exists');
        Assert.AreEqual(CustomerName, Contract."Customer Name", 'Customer of the contract');
        Assert.AreEqual('HX161-V1', Contract."Vehicle No.", 'Vehicle of the contract');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'A new contract is Open');
        Assert.AreEqual(CreditApproved, Contract."Credit Approved", 'Credit Approved records the credit check');
    end;

    local procedure CallerRowExistsHX161(): Boolean
    var
        Vehicle: Record "CGR Vehicle";
    begin
        exit(Vehicle.Get('HX161-CALLER'));
    end;
}
