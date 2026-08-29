codeunit 89376 "CG-AL-X156 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own table before seeding its own rows.

    local procedure ClearAll()
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.DeleteAll();
    end;

    local procedure SeedRequisition(No: Code[20]; RequisitionDescription: Text[100]; RequisitionQuantity: Decimal)
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.Init();
        Requisition."No." := No;
        Requisition.Description := RequisitionDescription;
        Requisition.Quantity := RequisitionQuantity;
        Requisition.Status := Requisition.Status::Open;
        Requisition.Insert();
    end;

    local procedure AssertRequisition(No: Code[20]; ExpectedDescription: Text[100]; ExpectedQuantity: Decimal; ExpectedStatus: Enum "CG X156 Requisition Status"; MessagePrefix: Text)
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Assert.IsTrue(Requisition.Get(No), MessagePrefix + ' - requisition exists');
        Assert.AreEqual(ExpectedDescription, Requisition.Description, MessagePrefix + ' - description');
        Assert.AreEqual(ExpectedQuantity, Requisition.Quantity, MessagePrefix + ' - quantity');
        Assert.AreEqual(ExpectedStatus.AsInteger(), Requisition.Status.AsInteger(), MessagePrefix + ' - status');
    end;

    [Test]
    procedure UpdateQuantitySucceedsForAnOpenRequisition()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ1', 'Office supplies restock', 10);

        Mgt.UpdateQuantity('REQ1', 25);

        AssertRequisition('REQ1', 'Office supplies restock', 25, Enum::"CG X156 Requisition Status"::Open,
            'An Open requisition after its quantity is changed');
    end;

    [Test]
    procedure UpdateQuantitySucceedsForARequisitionPendingApproval()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ2', 'Warehouse racking', 4);
        Mgt.SubmitForApproval('REQ2');

        Mgt.UpdateQuantity('REQ2', 6);

        AssertRequisition('REQ2', 'Warehouse racking', 6, Enum::"CG X156 Requisition Status"::PendingApproval,
            'A requisition awaiting approval after its quantity is changed');
    end;

    [Test]
    procedure UpdateQuantitySucceedsForARequisitionAwaitingPrepayment()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ3', 'Server maintenance contract', 1);
        Mgt.SubmitForApproval('REQ3');
        Mgt.ConfirmPrepayment('REQ3');

        Mgt.UpdateQuantity('REQ3', 2);

        AssertRequisition('REQ3', 'Server maintenance contract', 2, Enum::"CG X156 Requisition Status"::PrepaymentWait,
            'A requisition awaiting prepayment confirmation after its quantity is changed');
    end;

    [Test]
    procedure UpdateQuantityIsRefusedForAReleasedRequisition()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ4', 'Fleet tyres, quarter 3', 12);
        Mgt.SubmitForApproval('REQ4');
        Mgt.ConfirmPrepayment('REQ4');
        Mgt.Release('REQ4');
        Commit();

        asserterror Mgt.UpdateQuantity('REQ4', 99);

        Assert.ExpectedError('already been released');
    end;

    [Test]
    procedure TheRefusedUpdateLeavesTheReleasedRequisitionUnchanged()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ5', 'Annual software licences', 50);
        Mgt.SubmitForApproval('REQ5');
        Mgt.ConfirmPrepayment('REQ5');
        Mgt.Release('REQ5');
        Commit();

        asserterror Mgt.UpdateQuantity('REQ5', 999);

        AssertRequisition('REQ5', 'Annual software licences', 50, Enum::"CG X156 Requisition Status"::Released,
            'A Released requisition after a refused quantity change');
    end;

    [Test]
    procedure UpdatingOneRequisitionsQuantityDoesNotAffectAnother()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ6', 'North depot pallets', 30);
        SeedRequisition('REQ7', 'South depot pallets', 45);

        Mgt.UpdateQuantity('REQ6', 60);

        AssertRequisition('REQ6', 'North depot pallets', 60, Enum::"CG X156 Requisition Status"::Open,
            'REQ6 after its own quantity is changed');
        AssertRequisition('REQ7', 'South depot pallets', 45, Enum::"CG X156 Requisition Status"::Open,
            'REQ7 after an unrelated requisition''s quantity is changed');
    end;

    [Test]
    procedure TheStatusAdvancesThroughEachStageInOrder()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
    begin
        ClearAll();
        SeedRequisition('REQ8', 'Forklift service', 3);

        Mgt.SubmitForApproval('REQ8');
        AssertRequisition('REQ8', 'Forklift service', 3, Enum::"CG X156 Requisition Status"::PendingApproval,
            'REQ8 after being submitted for approval');

        Mgt.ConfirmPrepayment('REQ8');
        AssertRequisition('REQ8', 'Forklift service', 3, Enum::"CG X156 Requisition Status"::PrepaymentWait,
            'REQ8 after its prepayment is confirmed');

        Mgt.Release('REQ8');
        AssertRequisition('REQ8', 'Forklift service', 3, Enum::"CG X156 Requisition Status"::Released,
            'REQ8 after being released');
    end;
}
