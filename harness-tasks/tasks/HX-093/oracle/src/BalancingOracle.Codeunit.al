codeunit 87320 "HX093 Balancing Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    var
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('01', false, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, true, 'S1');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario02()
    var
        Spy: Codeunit "HX093 Posting Spy";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('02', false, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertStopped(Spy, ContractNo, 'S2');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario03()
    var
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('03', true, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, true, 'S3');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario04()
    var
        Spy: Codeunit "HX093 Posting Spy";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('04', true, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertStopped(Spy, ContractNo, 'S4');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario05()
    var
        Spy: Codeunit "HX093 Posting Spy";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        BalancingEntry: Record "CGR Balancing Entry";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('05', true, '', '1940', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, false, 'S5');
        HX093AssertPosts(Spy, ContractNo, 1, 'S5');

        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.IsTrue(LedgerEntry.FindFirst(), 'S5: the rental ledger entry is posted');
        Assert.AreNotEqual(0, LedgerEntry.Amount, 'S5: the rental ledger entry has an amount');
        BalancingEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, BalancingEntry.Count(), 'S5: one balancing entry');
        BalancingEntry.FindFirst();
        Assert.AreEqual('1940', BalancingEntry."Account No.", 'S5: balanced against the matched payment method''s account');
        Assert.AreEqual(-LedgerEntry.Amount, BalancingEntry.Amount, 'S5: the balancing amount offsets the ledger amount');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario06()
    var
        Spy: Codeunit "HX093 Posting Spy";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('06', false, '1940', '', false, true, false, true, true, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, false, 'S6');
        HX093AssertPosts(Spy, ContractNo, 0, 'S6');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);

        HX093Arrange('6N', false, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, true, 'S6 with the flag off');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario07()
    var
        Spy: Codeunit "HX093 Posting Spy";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('07', false, '1940', '', true, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, false, 'S7');
        HX093AssertPosts(Spy, ContractNo, 0, 'S7');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);

        HX093Arrange('7N', false, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, true, 'S7 with a method that does not post to the customer account');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario08()
    var
        Spy: Codeunit "HX093 Posting Spy";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('08', false, '1940', '', false, true, true, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, false, 'S8');
        HX093AssertPosts(Spy, ContractNo, 0, 'S8');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);

        HX093Arrange('8N', false, '1940', '', false, true, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, true, 'S8 with a payment that is not externally settled');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario09()
    var
        Spy: Codeunit "HX093 Posting Spy";
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('09', true, '', '', false, false, false, true, false, ContractNo, VehicleNo, CodeA, CodeB);
        HX093AssertProblems(ContractNo, false, false, 'S9');
        HX093AssertPosts(Spy, ContractNo, 0, 'S9');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    [Test]
    procedure Scenario10()
    var
        Contract: Record "CGR Rental Contract";
        ContractCheck: Codeunit "CGR Contract Check";
        Problems: List of [Code[30]];
        ContractNo: Code[20];
        VehicleNo: Code[20];
        CodeA: Code[10];
        CodeB: Code[10];
    begin
        HX093Arrange('10', false, '1940', '', false, true, false, false, false, ContractNo, VehicleNo, CodeA, CodeB);
        Contract.Get(ContractNo);
        Contract."Vehicle No." := '';
        Contract.Modify();
        Commit();

        ContractCheck.CheckContract(ContractNo, Problems);
        Assert.IsTrue(Problems.Contains('NOT-RETURNED'), 'S10: NOT-RETURNED listed');
        Assert.IsTrue(Problems.Contains('NO-VEHICLE'), 'S10: NO-VEHICLE listed');
        Assert.IsTrue(Problems.Contains('NO-BALANCING-ACCOUNT'), 'S10: NO-BALANCING-ACCOUNT listed');
        Assert.AreEqual(3, Problems.Count(), 'S10: number of problems listed');
        HX093Cleanup(ContractNo, VehicleNo, CodeA, CodeB);
    end;

    // Method A has AccountA; method B has AccountB and BToCustomer. The contract carries method A
    // when ContractOnA, otherwise method B. The matched payment (when WithMatch) uses method B.
    local procedure HX093Arrange(Tag: Text; ContractOnA: Boolean; AccountA: Code[20]; AccountB: Code[20]; BToCustomer: Boolean; WithMatch: Boolean; Settled: Boolean; Returned: Boolean; ImportFlag: Boolean; var ContractNo: Code[20]; var VehicleNo: Code[20]; var CodeA: Code[10]; var CodeB: Code[10])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        MatchedPayment: Record "CGR Matched Payment";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        Fragment: Text;
    begin
        SessionContext.Reset();
        Fragment := DelChr(Format(CreateGuid()), '=', '{}-');
        ContractNo := CopyStr('HX093-' + Tag + '-' + Fragment, 1, 20);
        VehicleNo := CopyStr('HX093V' + Tag + '-' + Fragment, 1, 20);
        CodeA := CopyStr('H' + Tag + 'A' + Fragment, 1, 10);
        CodeB := CopyStr('H' + Tag + 'B' + Fragment, 1, 10);

        HX093Method(CodeA, AccountA, false);
        HX093Method(CodeB, AccountB, BToCustomer);

        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();

        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'Desk customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract."Start Km" := 1000;
        Contract."Return Km" := 1000;
        Contract."Pricing Method" := Contract."Pricing Method"::Daily;
        if Returned then
            Contract.Status := Contract.Status::Returned
        else
            Contract.Status := Contract.Status::Open;
        if ContractOnA then
            Contract."Payment Method Code" := CodeA
        else
            Contract."Payment Method Code" := CodeB;
        Contract.Insert();

        if WithMatch then begin
            MatchedPayment.Init();
            MatchedPayment."Contract No." := ContractNo;
            MatchedPayment."Payment Method Code" := CodeB;
            MatchedPayment.Amount := 150;
            MatchedPayment."Externally Settled" := Settled;
            MatchedPayment.Insert();
        end;

        Setup.GetOrCreate();
        Setup."Post Payments on Import" := ImportFlag;
        Setup.Modify();
        Commit();
    end;

    local procedure HX093Method(MethodCode: Code[10]; AccountNo: Code[20]; ToCustomer: Boolean)
    var
        PaymentMethod: Record "CGR Payment Method";
    begin
        PaymentMethod.Init();
        PaymentMethod.Code := MethodCode;
        PaymentMethod.Description := 'Card';
        PaymentMethod."Balancing Account No." := AccountNo;
        PaymentMethod."Posts to Customer Account" := ToCustomer;
        PaymentMethod.Insert();
    end;

    local procedure HX093AssertProblems(ContractNo: Code[20]; NotReturned: Boolean; NoBalancingAccount: Boolean; Step: Text)
    var
        ContractCheck: Codeunit "CGR Contract Check";
        Problems: List of [Code[30]];
        Expected: Integer;
    begin
        ContractCheck.CheckContract(ContractNo, Problems);
        Assert.AreEqual(NotReturned, Problems.Contains('NOT-RETURNED'), Step + ': NOT-RETURNED listed');
        Assert.AreEqual(NoBalancingAccount, Problems.Contains('NO-BALANCING-ACCOUNT'), Step + ': NO-BALANCING-ACCOUNT listed');
        if NotReturned then
            Expected += 1;
        if NoBalancingAccount then
            Expected += 1;
        Assert.AreEqual(Expected, Problems.Count(), Step + ': number of problems listed');
    end;

    local procedure HX093AssertStopped(var Spy: Codeunit "HX093 Posting Spy"; ContractNo: Code[20]; Step: Text)
    var
        Contract: Record "CGR Rental Contract";
    begin
        Spy.HX093Watch(ContractNo);
        BindSubscription(Spy);
        Contract.Get(ContractNo);
        asserterror Codeunit.Run(Codeunit::"CGR Rental-Post", Contract);
        UnbindSubscription(Spy);
        Assert.AreEqual(0, Spy.HX093LedgerInserts(), Step + ': no rental ledger entry was written');
        Assert.AreEqual(0, Spy.HX093BalancingInserts(), Step + ': no balancing entry was written');
        Assert.AreEqual(0, Spy.HX093BeforePostCalls(), Step + ': posting stopped before OnBeforePostRentalContract');
        Assert.AreEqual(0, Spy.HX093ContractModifies(), Step + ': the contract was not modified');
        Assert.AreEqual(0, Spy.HX093AfterPostCalls(), Step + ': OnAfterPostRentalContract was not raised');
    end;

    local procedure HX093AssertPosts(var Spy: Codeunit "HX093 Posting Spy"; ContractNo: Code[20]; BalancingCount: Integer; Step: Text)
    var
        Contract: Record "CGR Rental Contract";
        BalancingEntry: Record "CGR Balancing Entry";
        Posted: Boolean;
    begin
        Spy.HX093Watch(ContractNo);
        BindSubscription(Spy);
        Contract.Get(ContractNo);
        Posted := Codeunit.Run(Codeunit::"CGR Rental-Post", Contract);
        UnbindSubscription(Spy);
        Assert.IsTrue(Posted, Step + ': the contract posts. ' + GetLastErrorText());
        Assert.AreEqual(1, Spy.HX093LedgerInserts(), Step + ': one rental ledger entry');
        Assert.AreEqual(1, Spy.HX093BeforePostCalls(), Step + ': OnBeforePostRentalContract raised once');
        Assert.AreEqual(1, Spy.HX093AfterPostCalls(), Step + ': OnAfterPostRentalContract raised once');
        Assert.AreEqual(BalancingCount, Spy.HX093BalancingInserts(), Step + ': balancing entries written');
        BalancingEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(BalancingCount, BalancingEntry.Count(), Step + ': balancing entries stored');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, Step + ': the contract is posted');
    end;

    local procedure HX093Cleanup(ContractNo: Code[20]; VehicleNo: Code[20]; CodeA: Code[10]; CodeB: Code[10])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        BalancingEntry: Record "CGR Balancing Entry";
        MatchedPayment: Record "CGR Matched Payment";
        PaymentMethod: Record "CGR Payment Method";
        Setup: Record "CGR Setup";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        LedgerEntry.DeleteAll();
        BalancingEntry.SetRange("Contract No.", ContractNo);
        BalancingEntry.DeleteAll();
        if MatchedPayment.Get(ContractNo) then
            MatchedPayment.Delete();
        if Contract.Get(ContractNo) then
            Contract.Delete();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        if PaymentMethod.Get(CodeA) then
            PaymentMethod.Delete();
        if PaymentMethod.Get(CodeB) then
            PaymentMethod.Delete();
        Setup.GetOrCreate();
        Setup."Post Payments on Import" := false;
        Setup.Modify();
        Commit();
    end;
}
