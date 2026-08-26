codeunit 89324 "CG-AL-X130 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Joined(Ids: List of [Code[20]]): Text
    var
        Id: Code[20];
        Result: Text;
    begin
        foreach Id in Ids do begin
            if Result <> '' then
                Result += '|';
            Result += Id;
        end;
        exit(Result);
    end;

    [Test]
    procedure NoSignupsMeansNothingIsWaitingYet()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
    begin
        Tracker.Attach(Queue.PendingSignups());

        Assert.AreEqual('', Joined(Queue.PendingSignups()), 'The queue should not report any waiting customers yet');
        Assert.AreEqual('', Joined(Tracker.AwaitingOutreach()), 'The tracker should not report any waiting customers yet');
    end;

    [Test]
    procedure TrackerSeesSignupsAddedBeforeAndAfterAttaching()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
    begin
        Queue.QueueSignup('CUST001');
        Queue.QueueSignup('CUST002');

        Tracker.Attach(Queue.PendingSignups());

        Queue.QueueSignup('CUST003');
        Queue.QueueSignup('CUST004');

        Assert.AreEqual('CUST001|CUST002|CUST003|CUST004', Joined(Queue.PendingSignups()), 'The queue must report every customer who signed up, in order');
        Assert.AreEqual('CUST001|CUST002|CUST003|CUST004', Joined(Tracker.AwaitingOutreach()), 'The tracker must report every customer who signed up, including those who signed up after it started watching');
    end;

    [Test]
    procedure TrackerAgreesWithQueueAfterStartingANewDay()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
    begin
        Queue.QueueSignup('CUST010');
        Queue.QueueSignup('CUST011');
        Tracker.Attach(Queue.PendingSignups());

        Queue.StartNewDay();
        Queue.QueueSignup('CUST020');

        Assert.AreEqual('CUST020', Joined(Queue.PendingSignups()), 'The queue itself must only report the new day''s signup');
        Assert.AreEqual('CUST020', Joined(Tracker.AwaitingOutreach()), 'The tracker must report exactly the same waiting customers the queue reports');
    end;

    [Test]
    procedure TrackerAgreesWithQueueAcrossSeveralNewDays()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
        Day: Integer;
        ExpectedIds: Text;
    begin
        Tracker.Attach(Queue.PendingSignups());

        for Day := 1 to 4 do begin
            Queue.StartNewDay();

            Assert.AreEqual('', Joined(Queue.PendingSignups()), 'The queue must report nothing waiting right after starting a new day');
            Assert.AreEqual('', Joined(Tracker.AwaitingOutreach()), 'The tracker must report nothing waiting right after starting a new day');

            Queue.QueueSignup('D' + Format(Day) + 'CUSTA');
            Queue.QueueSignup('D' + Format(Day) + 'CUSTB');

            ExpectedIds := 'D' + Format(Day) + 'CUSTA|D' + Format(Day) + 'CUSTB';

            Assert.AreEqual(ExpectedIds, Joined(Queue.PendingSignups()), 'The queue must only report the current day''s signups');
            Assert.AreEqual(ExpectedIds, Joined(Tracker.AwaitingOutreach()), 'The tracker must report exactly the same waiting customers the queue reports, every day');
        end;
    end;

    [Test]
    procedure TwoIndependentQueuesTrackTheirOwnCustomers()
    var
        QueueA: Codeunit "CG X130 Signup Queue";
        TrackerA: Codeunit "CG X130 Outreach Tracker";
        QueueB: Codeunit "CG X130 Signup Queue";
        TrackerB: Codeunit "CG X130 Outreach Tracker";
    begin
        QueueA.QueueSignup('CUSTA1');
        TrackerA.Attach(QueueA.PendingSignups());

        QueueB.QueueSignup('CUSTB1');
        TrackerB.Attach(QueueB.PendingSignups());

        QueueA.StartNewDay();
        QueueA.QueueSignup('CUSTA2');

        Assert.AreEqual('CUSTB1', Joined(QueueB.PendingSignups()), 'A second, unrelated queue must not be affected by another queue starting a new day');
        Assert.AreEqual('CUSTB1', Joined(TrackerB.AwaitingOutreach()), 'A second, unrelated tracker must not be affected by another queue starting a new day');

        Assert.AreEqual('CUSTA2', Joined(QueueA.PendingSignups()), 'The queue must only report the new day''s signup');
        Assert.AreEqual('CUSTA2', Joined(TrackerA.AwaitingOutreach()), 'The tracker must report exactly the same waiting customer the queue reports');
    end;
}
