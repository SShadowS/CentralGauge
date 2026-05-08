codeunit 90099 "CG xRec Spike Runner"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure RunAllSpikes()
    var
        Result: TextBuilder;
    begin
        Result.AppendLine('=== CG xRec Spike Results ===');
        Result.AppendLine('');
        Result.AppendLine('=== U1: tableext xRec in Customer.OnAfterModifyEvent ===');
        Result.AppendLine(SpikeU1());
        Result.AppendLine('');
        Result.AppendLine('=== U2: mid-trigger Rec.Modify then xRec read ===');
        Result.AppendLine(SpikeU2());
        Result.AppendLine('');
        Result.AppendLine('=== U3: CreateGuid + IsolatedStorage no-Modify (E-Seal pattern) ===');
        Result.AppendLine(SpikeU3());
        Result.AppendLine('');
        Result.AppendLine('=== U4: OnAfterValidateEvent on no-op revalidate ===');
        Result.AppendLine(SpikeU4());
        Result.AppendLine('');
        Result.AppendLine('=== END ===');
        Error(Result.ToText());
    end;

    local procedure SpikeU1(): Text
    var
        Cust: Record Customer;
        Logger: Codeunit "CG Spike Logger";
        Tb: TextBuilder;
    begin
        Logger.Reset();
        if not Cust.FindFirst() then
            exit('FAIL: no Customer in DB');
        Tb.AppendLine(StrSubstNo('Using Customer No.=%1', Cust."No."));
        // Baseline: set extension field to OLD
        Cust."CG Spike Ext" := 'OLD';
        Cust.Modify();
        Tb.AppendLine('After baseline modify (Ext=OLD):');
        Tb.AppendLine('  Logger: ' + Logger.GetAll());
        // Operative: change extension field to NEW
        Logger.Reset();
        Cust."CG Spike Ext" := 'NEW';
        Cust.Modify();
        Tb.AppendLine('After operative modify (Ext OLD -> NEW):');
        Tb.AppendLine('  Logger: ' + Logger.GetAll());
        Tb.AppendLine('Verdict: if xRec.Ext=OLD => standard semantics; if xRec.Ext=NEW => author claim true (synced before event)');
        exit(Tb.ToText());
    end;

    local procedure SpikeU2(): Text
    var
        Mid: Record "CG Spike Mid Trigger";
        Logger: Codeunit "CG Spike Logger";
        Tb: TextBuilder;
    begin
        Logger.Reset();
        Mid.DeleteAll();
        Mid.Init();
        Mid.Code := 'A';
        Mid.Watched := 1;
        Mid.Insert();
        Tb.AppendLine('Inserted row Code=A Watched=1');
        Mid.Get('A');
        Mid.Validate(Watched, 2);
        Mid.Modify();
        Tb.AppendLine('After Validate(Watched, 2) + Modify:');
        Tb.AppendLine('  Logger: ' + Logger.GetAll());
        Tb.AppendLine('Verdict: xRec.Watched after mid-trigger Modify reveals platform behaviour');
        exit(Tb.ToText());
    end;

    local procedure SpikeU3(): Text
    var
        Mid: Record "CG Spike Mid Trigger";
        Mid2: Record "CG Spike Mid Trigger";
        InitialKey: Guid;
        AfterCallKey: Guid;
        AfterReGetKey: Guid;
        Tb: TextBuilder;
    begin
        Mid.DeleteAll();
        Mid.Init();
        Mid.Code := 'B';
        Mid.Watched := 0;
        Mid.Insert();
        InitialKey := Mid.StorageKey;
        Tb.AppendLine(StrSubstNo('Initial StorageKey (post-Insert): %1', Format(InitialKey)));
        Mid.SetSecretLikeESealSetup('hello');
        AfterCallKey := Mid.StorageKey;
        Tb.AppendLine(StrSubstNo('After SetSecret call (in-memory Rec): %1', Format(AfterCallKey)));
        if not Mid2.Get('B') then
            exit('FAIL: re-Get of Code=B returned false');
        AfterReGetKey := Mid2.StorageKey;
        Tb.AppendLine(StrSubstNo('After re-Get from DB: %1', Format(AfterReGetKey)));
        Tb.AppendLine(StrSubstNo('CallKey == ReGetKey? %1', AfterCallKey = AfterReGetKey));
        Tb.AppendLine(StrSubstNo('ReGetKey IsNullGuid? %1', IsNullGuid(AfterReGetKey)));
        Tb.AppendLine('Verdict: if ReGetKey is null GUID => SetSecret leaked (no Modify). E-Seal pattern is buggy.');
        exit(Tb.ToText());
    end;

    local procedure SpikeU4(): Text
    var
        Cust: Record Customer;
        Logger: Codeunit "CG Spike Logger";
        FirstFireCount: Integer;
        SecondFireCount: Integer;
        Tb: TextBuilder;
    begin
        Logger.Reset();
        if not Cust.FindFirst() then
            exit('FAIL: no Customer in DB');
        Tb.AppendLine(StrSubstNo('Using Customer No.=%1, Original Name=%2', Cust."No.", Cust.Name));
        // Validate to a new value
        Cust.Validate(Name, 'spike-name-1');
        Cust.Modify();
        FirstFireCount := Logger.GetCount();
        Tb.AppendLine(StrSubstNo('After 1st Validate(Name, "spike-name-1"): fires=%1', FirstFireCount));
        Tb.AppendLine('  Logger: ' + Logger.GetAll());
        // Re-validate same value
        Logger.Reset();
        Cust.Get(Cust."No.");
        Cust.Validate(Name, 'spike-name-1');
        Cust.Modify();
        SecondFireCount := Logger.GetCount();
        Tb.AppendLine(StrSubstNo('After 2nd Validate(Name, same value): fires=%1', SecondFireCount));
        Tb.AppendLine('  Logger: ' + Logger.GetAll());
        Tb.AppendLine('Verdict: if SecondFireCount > 0 then BC fires OnAfterValidate even on no-op; gate on xRec is necessary');
        exit(Tb.ToText());
    end;
}
