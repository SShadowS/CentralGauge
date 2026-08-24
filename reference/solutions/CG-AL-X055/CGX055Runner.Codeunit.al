codeunit 71420 "CG X055 Runner"
{
    Access = Internal;

    var
        CurrentState: Integer;

    procedure Start()
    begin
        CurrentState := 1;
    end;

    procedure Continue()
    begin
        CurrentState := 2;
    end;

    procedure Stop()
    begin
        CurrentState := 0;
    end;

    procedure State(): Integer
    begin
        exit(CurrentState);
    end;

    procedure Collect(Items: List of [Integer]): List of [Integer]
    var
        Seen: List of [Integer];
        Result: List of [Integer];
        Item: Integer;
    begin
        foreach Item in Items do
            if (Item > 0) and (Item <= 100) and not Seen.Contains(Item) then begin
                Seen.Add(Item);
                Result.Add(Item);
            end;

        exit(Result);
    end;
}
