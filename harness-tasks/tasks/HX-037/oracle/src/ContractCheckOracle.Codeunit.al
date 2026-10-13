codeunit 86200 "HX037 Contract Check Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ReadyContractHasNoProblems()
    var
        ContractCheck: Codeunit "CGR Contract Check";
        Problems: List of [Text];
    begin
        InsertHX37Contract('HX037-1', 'HX037-1V', true, 'Customer One', false);
        Problems.Add('HX037 stale problem');

        Assert.IsTrue(ContractCheck.CheckForPosting('HX037-1', Problems), 'A returned contract with a customer and a free vehicle passes the check');
        Assert.AreEqual(0, Problems.Count(), 'A contract without problems leaves the problem list empty');
    end;

    [Test]
    procedure TwoOwnProblemsListed()
    var
        Runner: Codeunit "HX037 Check Runner";
        Ok: Boolean;
    begin
        InsertHX37Contract('HX037-2', 'HX037-2V', false, '', false);
        Runner.SetContracts('HX037-2', '');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Checking a contract with two problems raises no error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.GetFirstResult(), 'A contract with problems fails the check');
        Assert.AreEqual(2, Runner.ProblemCount(), 'Both problems are listed');
        Assert.AreEqual('Rental contract HX037-2 must be returned before it is posted.', Runner.ProblemAt(1), 'The status problem is listed first');
        Assert.AreEqual('Rental contract HX037-2 has no customer name.', Runner.ProblemAt(2), 'The customer problem is listed second');
    end;

    [Test]
    procedure ExtensionProblemsListed()
    var
        Extension: Codeunit "HX037 Check Extension";
        Runner: Codeunit "HX037 Check Runner";
        Ok: Boolean;
    begin
        InsertHX37Contract('HX037-3', 'HX037-3V', true, 'Customer Three', false);
        Extension.AddProblem('HX037 ext A');
        Extension.AddProblem('HX037 ext B');
        BindSubscription(Extension);
        Runner.SetContracts('HX037-3', '');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Problems reported by an extension raise no error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.GetFirstResult(), 'A contract with extension problems fails the check');
        Assert.AreEqual(2, Runner.ProblemCount(), 'Both extension problems are listed');
        Assert.AreEqual('HX037 ext A', Runner.ProblemAt(1), 'The first extension problem is listed first');
        Assert.AreEqual('HX037 ext B', Runner.ProblemAt(2), 'The second extension problem is listed second');
    end;

    [Test]
    procedure OwnThenExtensionProblems()
    var
        Extension: Codeunit "HX037 Check Extension";
        Runner: Codeunit "HX037 Check Runner";
        Ok: Boolean;
    begin
        InsertHX37Contract('HX037-4', 'HX037-4V', true, 'Customer Four', true);
        Extension.AddProblem('HX037 ext A');
        BindSubscription(Extension);
        Runner.SetContracts('HX037-4', '');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Own and extension problems together raise no error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.GetFirstResult(), 'A contract on a blocked vehicle fails the check');
        Assert.AreEqual(2, Runner.ProblemCount(), 'The vehicle problem and the extension problem are listed');
        Assert.AreEqual('Vehicle HX037-4V has open damages.', Runner.ProblemAt(1), 'Own problems come before the extension problems');
        Assert.AreEqual('HX037 ext A', Runner.ProblemAt(2), 'The extension problem follows the own problems');
    end;

    [Test]
    procedure SingleProblemNotRaised()
    var
        Runner: Codeunit "HX037 Check Runner";
        Ok: Boolean;
    begin
        InsertHX37Contract('HX037-5', 'HX037-5V', true, '', false);
        Runner.SetContracts('HX037-5', '');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Checking a contract with one problem raises no error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.GetFirstResult(), 'A contract without a customer name fails the check');
        Assert.AreEqual(1, Runner.ProblemCount(), 'The one problem is listed');
        Assert.AreEqual('Rental contract HX037-5 has no customer name.', Runner.ProblemAt(1), 'The customer problem is listed');
    end;

    [Test]
    procedure OrdinaryExtensionErrorStopsCheck()
    var
        Extension: Codeunit "HX037 Check Extension";
        Runner: Codeunit "HX037 Check Runner";
        Ok: Boolean;
    begin
        InsertHX37Contract('HX037-6', 'HX037-6V', true, '', false);
        Extension.SetStop('HX037 stop');
        BindSubscription(Extension);
        Runner.SetContracts('HX037-6', '');

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'An ordinary error from an extension stops the check');
        Assert.AreEqual('HX037 stop', GetLastErrorText(), 'The check stops with the extension''s own error');
    end;

    [Test]
    procedure ListReplacedOnEachCall()
    var
        Runner: Codeunit "HX037 Check Runner";
        Ok: Boolean;
    begin
        InsertHX37Contract('HX037-7', 'HX037-7V', false, '', false);
        InsertHX37Contract('HX037-7B', 'HX037-7BV', true, 'Customer Seven', false);
        Runner.SetContracts('HX037-7', 'HX037-7B');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Checking two contracts in a row raises no error: ' + GetLastErrorText());
        Assert.IsFalse(Runner.GetFirstResult(), 'The first contract has problems');
        Assert.IsTrue(Runner.GetSecondResult(), 'The second contract has no problems');
        Assert.AreEqual(0, Runner.ProblemCount(), 'The second check replaces the problems of the first');
    end;

    local procedure InsertHX37Contract(ContractNo: Code[20]; VehicleNo: Code[20]; IsReturned: Boolean; CustomerName: Text[100]; VehicleBlocked: Boolean)
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Blocked := VehicleBlocked;
        Vehicle.Insert();

        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := CustomerName;
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270305D;
        if IsReturned then begin
            Contract.Status := Contract.Status::Returned;
            Contract."Start Km" := 1000;
            Contract."Return Km" := 1200;
        end else
            Contract.Status := Contract.Status::Open;
        Contract.Insert();
    end;
}
