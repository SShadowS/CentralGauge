codeunit 88821 "CG-AL-X068 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows.

    local procedure Reset()
    var
        Contact: Record "CG X068 Contact";
        SearchLog: Record "CG X068 Search Log";
    begin
        Contact.DeleteAll();
        SearchLog.DeleteAll();
    end;

    local procedure CreateContact(NewName: Text; NewCity: Text; NewEmail: Text)
    var
        Contact: Record "CG X068 Contact";
        Any: Codeunit Any;
    begin
        Contact.Init();
        Contact."No." := CopyStr(Any.AlphanumericText(20), 1, MaxStrLen(Contact."No."));
        Contact.Name := CopyStr(NewName, 1, MaxStrLen(Contact.Name));
        Contact.City := CopyStr(NewCity, 1, MaxStrLen(Contact.City));
        Contact.Email := CopyStr(NewEmail, 1, MaxStrLen(Contact.Email));
        Contact.Insert();
    end;

    [Test]
    procedure CountsAContactCarryingTheTextInNameOnly()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X1 ' + SearchText + ' Freight', 'TRYAL-X1 Plainville', '');
        CreateContact('TRYAL-X1 Ordinary Trading', 'TRYAL-X1 Plainville', '');

        Assert.AreEqual(1, ContactSearch.CountMatches(SearchText),
            'Expected the contact carrying the text in its name to count even though its city does not - matching one column is enough');
    end;

    [Test]
    procedure CountsAContactCarryingTheTextInCityOnly()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X2 Ordinary Trading', 'TRYAL-X2 ' + SearchText, '');
        CreateContact('TRYAL-X2 Other Trading', 'TRYAL-X2 Plainville', '');

        Assert.AreEqual(1, ContactSearch.CountMatches(SearchText),
            'Expected the contact carrying the text in its city to count even though its name does not - matching one column is enough');
    end;

    [Test]
    procedure CountsAContactMatchingInBothColumnsOnce()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X3 ' + SearchText + ' Logistics', 'Port ' + SearchText, '');

        Assert.AreEqual(1, ContactSearch.CountMatches(SearchText),
            'Expected a contact carrying the text in name and city to count exactly once - not once per column');
    end;

    [Test]
    procedure CountsTheFullSetForAGeneratedText()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact(SearchText + ' TRYAL-X4 Freight', 'TRYAL-X4 Plainhaven', '');
        CreateContact('TRYAL-X4 Mid ' + SearchText + ' Trading', 'TRYAL-X4 Plainhaven', '');
        CreateContact('TRYAL-X4 Ordinary Trading', 'Port ' + SearchText, '');
        CreateContact('TRYAL-X4 Ordinary Freight', 'TRYAL-X4 Plainhaven', '');

        Assert.AreEqual(3, ContactSearch.CountMatches(SearchText),
            'Expected the two contacts carrying the text in the name (at the start and in the middle) plus the one carrying it at the end of the city - and not the decoy carrying it nowhere');
    end;

    [Test]
    procedure LowercaseSearchFindsUppercaseValuesInBothColumns()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := LowerCase(Any.AlphabeticText(10));
        CreateContact('TRYAL-X5 ' + UpperCase(SearchText) + ' Group', 'TRYAL-X5 Plainville', '');
        CreateContact('TRYAL-X5 Ordinary Group', 'TRYAL-X5 ' + UpperCase(SearchText), '');

        Assert.AreEqual(2, ContactSearch.CountMatches(SearchText),
            'Expected the lowercase search text to find the value stored in uppercase in the name of one contact and in the city of the other - the search ignores case in both columns');
    end;

    [Test]
    procedure FindsNothingWhenTheTextIsInNeitherColumn()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
    begin
        Reset();
        CreateContact('TRYAL-X6 Ordinary Supplies', 'TRYAL-X6 Plainville', '');

        Assert.AreEqual(0, ContactSearch.CountMatches(Any.AlphabeticText(12)),
            'Expected 0 for a text that appears in no contact''s name or city - an empty result is zero, not an error');
    end;

    [Test]
    procedure ContactableCountsOnlyMatchesWithAnEmail()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X7 ' + SearchText + ' Freight', 'TRYAL-X7 Plainville', 'first@tryal.example');
        CreateContact('TRYAL-X7 Ordinary Trading', 'TRYAL-X7 ' + SearchText, 'second@tryal.example');
        CreateContact('TRYAL-X7 ' + SearchText + ' Group', 'TRYAL-X7 Plainville', '');

        Assert.AreEqual(2, ContactSearch.CountContactableMatches(SearchText),
            'Expected the name match and the city match that carry an e-mail - the matching contact with a blank e-mail must not count');
    end;

    [Test]
    procedure ContactableNeverCountsAContactOnItsEmailAlone()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X8 ' + SearchText + ' Freight', 'TRYAL-X8 Plainville', 'match@tryal.example');
        CreateContact('TRYAL-X8 Ordinary Trading', 'TRYAL-X8 Plainville', 'decoy@tryal.example');

        Assert.AreEqual(1, ContactSearch.CountContactableMatches(SearchText),
            'Expected only the contact that matches the text - having an e-mail must never add a contact the text search alone would not have found');
    end;

    [Test]
    procedure ContactableIsZeroWhenEveryMatchLacksAnEmail()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X9 ' + SearchText + ' Freight', 'TRYAL-X9 Plainville', '');
        CreateContact('TRYAL-X9 Ordinary Trading', 'TRYAL-X9 ' + SearchText, '');

        Assert.AreEqual(0, ContactSearch.CountContactableMatches(SearchText),
            'Expected 0 when every contact matching the text has a blank e-mail - matching the text is not enough to be contactable');
    end;

    [Test]
    procedure ContactableCountsABothColumnMatchWithAnEmailOnce()
    var
        ContactSearch: Codeunit "CG X068 Contact Search";
        Any: Codeunit Any;
        SearchText: Text;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X10 ' + SearchText + ' Logistics', 'Port ' + SearchText, 'both@tryal.example');
        CreateContact('TRYAL-X10 ' + SearchText + ' Freight', 'TRYAL-X10 Plainville', 'name@tryal.example');

        Assert.AreEqual(2, ContactSearch.CountContactableMatches(SearchText),
            'Expected the contact carrying the text in name and city to count exactly once among the contactable matches - not once per column');
    end;

    [Test]
    procedure SearchReturnsAndLogsTheSameCountAsCountMatches()
    var
        SearchSvc: Codeunit "CG X068 Search Svc";
        SearchLog: Record "CG X068 Search Log";
        Any: Codeunit Any;
        SearchText: Text;
        Returned: Integer;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X11 ' + SearchText + ' Freight', 'TRYAL-X11 Plainville', '');
        CreateContact('TRYAL-X11 Ordinary Trading', 'TRYAL-X11 ' + SearchText, '');

        Returned := SearchSvc.Search(SearchText);

        Assert.AreEqual(2, Returned,
            'Expected the search to return both the name match and the city match');

        Assert.AreEqual(1, SearchLog.Count(),
            'Expected exactly one recorded search for this lookup');

        SearchLog.FindLast();
        Assert.AreEqual(2, SearchLog."Matched Contacts",
            'Expected the recorded search to keep the same count the search itself returned');
        Assert.AreEqual(0, SearchLog."Contactable Contacts",
            'Expected the recorded search to keep the same contactable count the search computed');
    end;

    [Test]
    procedure SearchContactableNeverWritesToTheLog()
    var
        SearchSvc: Codeunit "CG X068 Search Svc";
        SearchLog: Record "CG X068 Search Log";
        Any: Codeunit Any;
        SearchText: Text;
        Returned: Integer;
    begin
        Reset();
        SearchText := Any.AlphabeticText(10);
        CreateContact('TRYAL-X12 ' + SearchText + ' Freight', 'TRYAL-X12 Plainville', 'reach@tryal.example');
        CreateContact('TRYAL-X12 Ordinary Trading', 'TRYAL-X12 ' + SearchText, '');

        Returned := SearchSvc.SearchContactable(SearchText);

        Assert.AreEqual(1, Returned,
            'Expected only the matching contact with an e-mail to count as contactable');
        Assert.AreEqual(0, SearchLog.Count(),
            'Expected a lookup that only reports the contactable count to leave no record behind');
    end;
}
