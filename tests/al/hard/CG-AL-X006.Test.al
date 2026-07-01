codeunit 80295 "CG-AL-X006 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearData()
    var
        Customer: Record "CG X006 Customer";
        Doc: Record "CG X006 Doc";
    begin
        Doc.DeleteAll();
        Customer.DeleteAll();
    end;

    [Test]
    procedure CollectsUnionOfOpenAndBlockedCustomerDocs()
    var
        CustA: Record "CG X006 Customer";
        CustB: Record "CG X006 Customer";
        DocOB: Record "CG X006 Doc";
        DocOU: Record "CG X006 Doc";
        DocCB: Record "CG X006 Doc";
        DocCU: Record "CG X006 Doc";
        Selector: Codeunit "CG X006 Selector";
        Result: Record "CG X006 Doc" temporary;
        Collected: Integer;
    begin
        // [GIVEN] one blocked customer and one unblocked customer
        ClearData();
        CustA.Init();
        CustA."No." := 'CUSTA';
        CustA.Blocked := true;
        CustA.Insert();

        CustB.Init();
        CustB."No." := 'CUSTB';
        CustB.Blocked := false;
        CustB.Insert();

        // [GIVEN] four docs covering every Status/Customer-Blocked combination
        DocOB.Init();
        DocOB."No." := 'DOC-OB'; // Open, blocked customer
        DocOB.Status := DocOB.Status::Open;
        DocOB."Customer No." := CustA."No.";
        DocOB.Insert();

        DocOU.Init();
        DocOU."No." := 'DOC-OU'; // Open, unblocked customer
        DocOU.Status := DocOU.Status::Open;
        DocOU."Customer No." := CustB."No.";
        DocOU.Insert();

        DocCB.Init();
        DocCB."No." := 'DOC-CB'; // Closed, blocked customer
        DocCB.Status := DocCB.Status::Closed;
        DocCB."Customer No." := CustA."No.";
        DocCB.Insert();

        DocCU.Init();
        DocCU."No." := 'DOC-CU'; // Closed, unblocked customer
        DocCU.Status := DocCU.Status::Closed;
        DocCU."Customer No." := CustB."No.";
        DocCU.Insert();
        Commit();

        // [WHEN] collecting relevant docs
        Collected := Selector.CollectRelevant(Result);

        // [THEN] exactly the three qualifying docs are reported
        Assert.AreEqual(3, Collected, 'Three docs should be collected');

        // [THEN] each qualifying doc is present in the temporary result, and
        // its other fields were actually carried over from the source doc
        // (not just the primary key)
        Assert.IsTrue(
          Result.Get('DOC-OB'), 'Open doc with blocked customer must be collected');
        Assert.AreEqual(
          DocOB.Status::Open, Result.Status, 'DOC-OB Status field must be copied from source doc');
        Assert.AreEqual(
          CustA."No.", Result."Customer No.", 'DOC-OB Customer No. field must be copied from source doc');

        Assert.IsTrue(
          Result.Get('DOC-OU'), 'Open doc with unblocked customer must be collected');
        Assert.AreEqual(
          DocOU.Status::Open, Result.Status, 'DOC-OU Status field must be copied from source doc');
        Assert.AreEqual(
          CustB."No.", Result."Customer No.", 'DOC-OU Customer No. field must be copied from source doc');

        Assert.IsTrue(
          Result.Get('DOC-CB'), 'Closed doc with blocked customer must be collected');
        Assert.AreEqual(
          DocCB.Status::Closed, Result.Status, 'DOC-CB Status field must be copied from source doc');
        Assert.AreEqual(
          CustA."No.", Result."Customer No.", 'DOC-CB Customer No. field must be copied from source doc');

        // [THEN] the closed doc with an unblocked customer is excluded
        Assert.IsFalse(
          Result.Get('DOC-CU'), 'Closed doc with unblocked customer must NOT be collected');

        // [THEN] the temporary result row count matches the returned count
        Result.Reset();
        Assert.AreEqual(
          3, Result.Count(), 'Temporary result row count must match returned count');
    end;

    [Test]
    procedure CollectsAllDocsForBlockedCustomerAcrossMultipleDocs()
    var
        CustBlocked: Record "CG X006 Customer";
        CustClear: Record "CG X006 Customer";
        DocA: Record "CG X006 Doc";
        DocB: Record "CG X006 Doc";
        DocC: Record "CG X006 Doc";
        DocD: Record "CG X006 Doc";
        Selector: Codeunit "CG X006 Selector";
        Result: Record "CG X006 Doc" temporary;
        Collected: Integer;
    begin
        // [GIVEN] a blocked customer with TWO closed docs (no Open-arm coverage
        // for either) and an unblocked customer with one open and one closed doc
        ClearData();
        CustBlocked.Init();
        CustBlocked."No." := 'BLKCU';
        CustBlocked.Blocked := true;
        CustBlocked.Insert();

        CustClear.Init();
        CustClear."No." := 'CLRCU';
        CustClear.Blocked := false;
        CustClear.Insert();

        DocA.Init();
        DocA."No." := 'DOCA';
        DocA.Status := DocA.Status::Closed;
        DocA."Customer No." := CustBlocked."No.";
        DocA.Insert();

        DocB.Init();
        DocB."No." := 'DOCB';
        DocB.Status := DocB.Status::Closed;
        DocB."Customer No." := CustBlocked."No.";
        DocB.Insert();

        DocC.Init();
        DocC."No." := 'DOCC';
        DocC.Status := DocC.Status::Open;
        DocC."Customer No." := CustClear."No.";
        DocC.Insert();

        DocD.Init();
        DocD."No." := 'DOCD';
        DocD.Status := DocD.Status::Closed;
        DocD."Customer No." := CustClear."No.";
        DocD.Insert();
        Commit();

        // [WHEN] collecting relevant docs
        Collected := Selector.CollectRelevant(Result);

        // [THEN] both closed docs of the blocked customer AND the open doc of
        // the unblocked customer are collected - three docs total
        Assert.AreEqual(3, Collected, 'Three docs should be collected');
        Assert.IsTrue(
          Result.Get('DOCA'), 'First closed doc of blocked customer must be collected');
        Assert.AreEqual(
          DocA.Status::Closed, Result.Status, 'DOCA Status field must be copied from source doc');
        Assert.AreEqual(
          CustBlocked."No.", Result."Customer No.", 'DOCA Customer No. field must be copied from source doc');

        Assert.IsTrue(
          Result.Get('DOCB'), 'Second closed doc of blocked customer must be collected');
        Assert.AreEqual(
          DocB.Status::Closed, Result.Status, 'DOCB Status field must be copied from source doc');
        Assert.AreEqual(
          CustBlocked."No.", Result."Customer No.", 'DOCB Customer No. field must be copied from source doc');

        Assert.IsTrue(
          Result.Get('DOCC'), 'Open doc of unblocked customer must be collected');
        Assert.AreEqual(
          DocC.Status::Open, Result.Status, 'DOCC Status field must be copied from source doc');
        Assert.AreEqual(
          CustClear."No.", Result."Customer No.", 'DOCC Customer No. field must be copied from source doc');

        // [THEN] the closed doc of the unblocked customer is excluded
        Assert.IsFalse(
          Result.Get('DOCD'), 'Closed doc of unblocked customer must NOT be collected');
    end;
}
