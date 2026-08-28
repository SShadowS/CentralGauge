codeunit 89355 "CG-AL-X135 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears its tables
    // before seeding its own rows. Unrelated orders are seeded with a
    // nonzero sentinel amount so "untouched" and "cleared" stay
    // distinguishable.

    local procedure Seed(No: Code[20]; StatusValue: Enum "CG X135 Order Status"; OrderAmount: Decimal; var Order: Record "CG X135 Order")
    begin
        Order.Init();
        Order."No." := No;
        Order.Description := 'Sentinel';
        Order.Amount := OrderAmount;
        Order.Status := StatusValue;
        Order.Insert();
    end;

    local procedure RequiredStatusFragment(ActionIdx: Integer): Text
    begin
        case ActionIdx of
            1:
                exit('Open');
            2, 3:
                exit('Released');
        end;
        exit('');
    end;

    local procedure ResultStatus(ActionIdx: Integer): Enum "CG X135 Order Status"
    begin
        case ActionIdx of
            1:
                exit(Enum::"CG X135 Order Status"::Released);
            2:
                exit(Enum::"CG X135 Order Status"::Open);
            3:
                exit(Enum::"CG X135 Order Status"::Posted);
        end;
        exit(Enum::"CG X135 Order Status"::Open);
    end;

    local procedure IsLegalCell(ActionIdx: Integer; StartStatus: Enum "CG X135 Order Status"): Boolean
    begin
        case ActionIdx of
            1:
                exit(StartStatus = Enum::"CG X135 Order Status"::Open);
            2:
                exit(StartStatus = Enum::"CG X135 Order Status"::Released);
            3:
                exit(StartStatus = Enum::"CG X135 Order Status"::Released);
        end;
        exit(false);
    end;

    local procedure InvokeAction(ActionIdx: Integer; var Order: Record "CG X135 Order")
    var
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        case ActionIdx of
            1:
                Lifecycle.Release(Order);
            2:
                Lifecycle.Reopen(Order);
            3:
                Lifecycle.Post(Order);
        end;
    end;

    [Test]
    procedure TransitionMatrixSweep()
    var
        Order: Record "CG X135 Order";
        DbOrder: Record "CG X135 Order";
        PostedOrder: Record "CG X135 Posted Order";
        Statuses: array[3] of Enum "CG X135 Order Status";
        ActionIdx: Integer;
        StatusIdx: Integer;
        No: Code[20];
        Legal: Boolean;
    begin
        Order.DeleteAll();
        PostedOrder.DeleteAll();

        Statuses[1] := Enum::"CG X135 Order Status"::Open;
        Statuses[2] := Enum::"CG X135 Order Status"::Released;
        Statuses[3] := Enum::"CG X135 Order Status"::Posted;

        for ActionIdx := 1 to 3 do
            for StatusIdx := 1 to 3 do begin
                No := CopyStr(StrSubstNo('SWP%1%2', ActionIdx, StatusIdx), 1, 20);
                Seed(No, Statuses[StatusIdx], 500, Order);
                Commit();

                Legal := IsLegalCell(ActionIdx, Statuses[StatusIdx]);

                if Legal then begin
                    InvokeAction(ActionIdx, Order);

                    Assert.AreEqual(
                        ResultStatus(ActionIdx).AsInteger(), Order.Status.AsInteger(),
                        StrSubstNo('Action %1 from status %2: the caller''s order variable must reflect the new status', ActionIdx, StatusIdx));

                    DbOrder.Get(No);
                    Assert.AreEqual(
                        ResultStatus(ActionIdx).AsInteger(), DbOrder.Status.AsInteger(),
                        StrSubstNo('Action %1 from status %2: the database must reflect the new status', ActionIdx, StatusIdx));

                    if ActionIdx = 3 then begin
                        Assert.AreEqual(
                            WorkDate(), DbOrder."Posted On",
                            StrSubstNo('Action %1 from status %2: posting must stamp Posted On with the work date', ActionIdx, StatusIdx));
                        Assert.IsTrue(
                            PostedOrder.Get(No),
                            StrSubstNo('Action %1 from status %2: a completed post must leave a posted record behind', ActionIdx, StatusIdx));
                        Assert.AreEqual(
                            500, PostedOrder.Amount,
                            StrSubstNo('Action %1 from status %2: the posted record must carry the order amount', ActionIdx, StatusIdx));
                    end;
                end else begin
                    asserterror InvokeAction(ActionIdx, Order);
                    Assert.ExpectedError(RequiredStatusFragment(ActionIdx));

                    DbOrder.Get(No);
                    Assert.AreEqual(
                        Statuses[StatusIdx].AsInteger(), DbOrder.Status.AsInteger(),
                        StrSubstNo('Action %1 from status %2: a rejected action must leave the status untouched', ActionIdx, StatusIdx));

                    if ActionIdx = 3 then
                        Assert.IsFalse(
                            PostedOrder.Get(No),
                            StrSubstNo('Action %1 from status %2: a rejected post must not leave a posted record behind', ActionIdx, StatusIdx));
                end;
            end;
    end;

    [Test]
    procedure OpenOrderReleasesAndReopens()
    var
        Order: Record "CG X135 Order";
        DbOrder: Record "CG X135 Order";
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        Order.DeleteAll();

        Seed('ORD-3', Enum::"CG X135 Order Status"::Open, 400, Order);

        Lifecycle.Release(Order);
        Assert.AreEqual(Enum::"CG X135 Order Status"::Released.AsInteger(), Order.Status.AsInteger(), 'Releasing an Open order must move it to Released');

        Lifecycle.Reopen(Order);
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), Order.Status.AsInteger(), 'Reopening a Released order must move it back to Open');

        DbOrder.Get('ORD-3');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), DbOrder.Status.AsInteger(), 'The database must reflect the reopened status');
        Assert.AreEqual(400, DbOrder.Amount, 'Amount must survive the release/reopen cycle untouched');

        Commit();
        asserterror Lifecycle.Reopen(Order);
        Assert.ExpectedError('Released');
    end;

    [Test]
    procedure ReleasedOrderPostsAndLeavesOthersUntouched()
    var
        OrderA: Record "CG X135 Order";
        DbOrderA: Record "CG X135 Order";
        OrderB: Record "CG X135 Order";
        DbOrderB: Record "CG X135 Order";
        PostedOrder: Record "CG X135 Posted Order";
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        OrderA.DeleteAll();
        PostedOrder.DeleteAll();

        Seed('ORD-A', Enum::"CG X135 Order Status"::Open, 750, OrderA);
        Seed('ORD-B', Enum::"CG X135 Order Status"::Open, 999, OrderB);

        Lifecycle.Release(OrderA);
        Lifecycle.Reopen(OrderA);
        Lifecycle.Release(OrderA);
        Lifecycle.Post(OrderA);

        Assert.AreEqual(Enum::"CG X135 Order Status"::Posted.AsInteger(), OrderA.Status.AsInteger(), 'A released order that posts must end up Posted on the caller''s variable');
        DbOrderA.Get('ORD-A');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Posted.AsInteger(), DbOrderA.Status.AsInteger(), 'A released order that posts must end up Posted in the database');
        Assert.AreEqual(WorkDate(), DbOrderA."Posted On", 'Posting must stamp Posted On with the work date');
        Assert.IsTrue(PostedOrder.Get('ORD-A'), 'A completed post must leave a posted record behind');
        Assert.AreEqual(750, PostedOrder.Amount, 'The posted record must carry the order amount');

        DbOrderB.Get('ORD-B');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), DbOrderB.Status.AsInteger(), 'Posting one order must not change an unrelated order''s status');
        Assert.AreEqual(999, DbOrderB.Amount, 'Posting one order must not change an unrelated order''s amount');
        Assert.IsFalse(PostedOrder.Get('ORD-B'), 'Posting one order must not create a posted record for an unrelated order');
    end;

    [Test]
    procedure OpenOrderCannotSkipStraightToPosted()
    var
        Order: Record "CG X135 Order";
        DbOrder: Record "CG X135 Order";
        PostedOrder: Record "CG X135 Posted Order";
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        Order.DeleteAll();
        PostedOrder.DeleteAll();

        Seed('ORD-C', Enum::"CG X135 Order Status"::Open, 750, Order);
        Commit();

        asserterror Lifecycle.Post(Order);
        Assert.ExpectedError('Released');

        DbOrder.Get('ORD-C');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), DbOrder.Status.AsInteger(), 'A rejected post must leave the order Open');
        Assert.IsTrue(DbOrder."Posted On" = 0D, 'A rejected post must leave Posted On blank');
        Assert.IsFalse(PostedOrder.Get('ORD-C'), 'A rejected post must not leave a posted record behind');
    end;
}
