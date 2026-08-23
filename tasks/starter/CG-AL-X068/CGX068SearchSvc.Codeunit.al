codeunit 70333 "CG X068 Search Svc"
{
    // Thin front door for the contact search box: runs the search, records
    // it for the audit log, and hands the caller a count.

    procedure Search(SearchText: Text): Integer
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        MatchCount: Integer;
        ContactableCount: Integer;
    begin
        MatchCount := ContactSearch.CountMatches(SearchText);
        ContactableCount := ContactSearch.CountContactableMatches(SearchText);
        LogSearch(SearchText, MatchCount, ContactableCount);
        exit(MatchCount);
    end;

    procedure SearchContactable(SearchText: Text): Integer
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
    begin
        exit(ContactSearch.CountContactableMatches(SearchText));
    end;

    local procedure LogSearch(SearchText: Text; MatchCount: Integer; ContactableCount: Integer)
    var
        SearchLog: Record "CG X068 Search Log";
    begin
        SearchLog.Init();
        SearchLog."Search Text" := CopyStr(SearchText, 1, MaxStrLen(SearchLog."Search Text"));
        SearchLog."Matched Contacts" := MatchCount;
        SearchLog."Contactable Contacts" := ContactableCount;
        SearchLog.Insert(true);
    end;
}
