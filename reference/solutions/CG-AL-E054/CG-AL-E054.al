codeunit 70054 "CG Sequential Guid Generator"
{
    Access = Public;

    procedure GenerateSequentialGuid(): Guid
    begin
        exit(CreateGuid());
    end;

    procedure GenerateMultipleGuids(Count: Integer): List of [Guid]
    var
        GuidList: List of [Guid];
        i: Integer;
    begin
        for i := 1 to Count do
            GuidList.Add(CreateGuid());

        exit(GuidList);
    end;

    procedure IsSequentialGuid(GuidValue: Guid): Boolean
    var
        EmptyGuid: Guid;
    begin
        exit(GuidValue <> EmptyGuid);
    end;

    procedure CompareGuids(Guid1: Guid; Guid2: Guid): Boolean
    begin
        exit(Guid1 <> Guid2);
    end;
}