codeunit 88812 "CG-AL-X059 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure MakeOrder(StatusValue: Enum "CG X059 Status"; var Order: Record "CG X059 Order")
    begin
        Clear(Order);
        Order."No." := 'O-1';
        Order.Status := StatusValue;
    end;

    [Test]
    procedure DraftIsAccepted()
    var
        Gate: Codeunit "CG X059 Gate";
        Order: Record "CG X059 Order";
    begin
        MakeOrder(Enum::"CG X059 Status"::Draft, Order);
        Gate.RequireDraft(Order);
        // Reaching here without an error is the assertion.
        Assert.AreEqual(
            Enum::"CG X059 Status"::Draft.AsInteger(), Order.Status.AsInteger(),
            'A Draft order must pass the gate unchanged');
    end;

    [Test]
    procedure ReleasedIsRejected()
    var
        Gate: Codeunit "CG X059 Gate";
        Order: Record "CG X059 Order";
    begin
        MakeOrder(Enum::"CG X059 Status"::Released, Order);
        asserterror Gate.RequireDraft(Order);
        Assert.ExpectedError('Status');
    end;

    [Test]
    procedure ClosedIsRejected()
    var
        Gate: Codeunit "CG X059 Gate";
        Order: Record "CG X059 Order";
    begin
        MakeOrder(Enum::"CG X059 Status"::Closed, Order);
        asserterror Gate.RequireDraft(Order);
        Assert.ExpectedError('Status');
    end;
}
