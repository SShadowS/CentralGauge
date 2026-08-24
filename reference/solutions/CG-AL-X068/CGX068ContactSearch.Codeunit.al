codeunit 70331 "CG X068 Contact Search"
{
    // Backs the contact list's search box: one term, matched against the
    // contact's name or its city.

    procedure CountMatches(SearchText: Text): Integer
    var
        Contact: Record "CG X068 Contact";
    begin
        ApplyCrossColumnSearch(Contact, SearchText);
        exit(Contact.Count());
    end;

    procedure CountContactableMatches(SearchText: Text): Integer
    var
        Contact: Record "CG X068 Contact";
    begin
        ApplyCrossColumnSearch(Contact, SearchText);
        Contact.SetFilter(Email, '<>%1', '');
        exit(Contact.Count());
    end;

    local procedure ApplyCrossColumnSearch(var Contact: Record "CG X068 Contact"; SearchText: Text)
    begin
        Contact.FilterGroup(-1);
        Contact.SetFilter(Name, '@*' + SearchText + '*');
        Contact.SetFilter(City, '@*' + SearchText + '*');
        Contact.FilterGroup(0);
    end;
}
