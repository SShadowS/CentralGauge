codeunit 70540 "CG H054 Cache"
{
    SingleInstance = true;
    Access = Public;

    var
        CacheValues: Dictionary of [Code[20], Integer];
        InsertionOrder: List of [Code[20]];

    procedure Add("Key": Code[20]; Value: Integer)
    var
        OldestKey: Code[20];
    begin
        if CacheValues.ContainsKey("Key") then begin
            CacheValues.Set("Key", Value);
            exit;
        end;

        if InsertionOrder.Count() >= GetMaxCapacity() then begin
            OldestKey := InsertionOrder.Get(1);
            InsertionOrder.RemoveAt(1);
            CacheValues.Remove(OldestKey);
        end;

        CacheValues.Add("Key", Value);
        InsertionOrder.Add("Key");
    end;

    procedure Get("Key": Code[20]; var Value: Integer): Boolean
    var
        StoredValue: Integer;
    begin
        if not CacheValues.Get("Key", StoredValue) then
            exit(false);

        Value := StoredValue;
        exit(true);
    end;

    procedure Count(): Integer
    begin
        exit(InsertionOrder.Count());
    end;

    procedure Clear()
    begin
        System.Clear(CacheValues);
        System.Clear(InsertionOrder);
    end;

    local procedure GetMaxCapacity(): Integer
    begin
        exit(5);
    end;
}