codeunit 80009 "CG-AL-E009 Test"
{
    // Tests for CG-AL-E009: Basic XMLport - Item Export
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibraryInventory: Codeunit "Library - Inventory";
        LibraryUtility: Codeunit "Library - Utility";

    [Test]
    procedure TestXMLportExists()
    var
        AllObj: Record AllObj;
    begin
        // [SCENARIO] Item Export XMLport exists with correct ID
        // [GIVEN] The XMLport definition
        // [WHEN] We check for the XMLport in system objects
        // [THEN] XMLport 70000 "Item Export" exists
        AllObj.SetRange("Object Type", AllObj."Object Type"::XMLport);
        AllObj.SetRange("Object ID", 70000);
        Assert.IsTrue(AllObj.FindFirst(), 'XMLport 70000 should exist');
        Assert.AreEqual('Item Export', AllObj."Object Name", 'XMLport should be named "Item Export"');
    end;

    [Test]
    procedure TestXMLportExportsToFile()
    var
        Item: Record Item;
        ItemExport: XMLport "Item Export";
        TempBlob: Codeunit "Temp Blob";
        OutStream: OutStream;
        InStream: InStream;
        XMLText: Text;
        Line: Text;
    begin
        // [SCENARIO] Item Export XMLport can export items to XML
        // [GIVEN] An item record
        LibraryInventory.CreateItem(Item);

        // [WHEN] We export using the XMLport
        TempBlob.CreateOutStream(OutStream);
        Item.SetRange("No.", Item."No.");
        ItemExport.SetTableView(Item);
        ItemExport.SetDestination(OutStream);
        ItemExport.Export();

        // [THEN] XML content is generated
        TempBlob.CreateInStream(InStream);
        XMLText := '';
        while not InStream.EOS() do begin
            InStream.ReadText(Line);
            XMLText += Line;
        end;
        Assert.AreNotEqual('', XMLText, 'XML content should be generated');

        // Cleanup
        Item.Delete();
    end;

    [Test]
    procedure TestXMLportContainsAllRequiredFields()
    var
        Item: Record Item;
        ItemExport: XMLport "Item Export";
        TempBlob: Codeunit "Temp Blob";
        OutStream: OutStream;
        InStream: InStream;
        XMLText: Text;
        Line: Text;
    begin
        // [SCENARIO] Exported XML contains all required fields: No, Description, Unit Price, Inventory
        // [GIVEN] An item with specific data
        LibraryInventory.CreateItem(Item);
        Item.Description := 'Test Item Description';
        Item."Unit Price" := 99.99;
        Item.Inventory := 50;
        Item.Modify();

        // [WHEN] We export using the XMLport
        TempBlob.CreateOutStream(OutStream);
        Item.SetRange("No.", Item."No.");
        ItemExport.SetTableView(Item);
        ItemExport.SetDestination(OutStream);
        ItemExport.Export();

        // [THEN] XML contains all required fields
        TempBlob.CreateInStream(InStream);
        XMLText := '';
        while not InStream.EOS() do begin
            InStream.ReadText(Line);
            XMLText += Line;
        end;
        Assert.IsTrue(XMLText.Contains(Item."No."), 'XML should contain item No');
        Assert.IsTrue(XMLText.Contains('Test Item Description'), 'XML should contain Description');
        Assert.IsTrue(XMLText.Contains('99.99') or XMLText.Contains('99,99'), 'XML should contain Unit Price');
        Assert.IsTrue(XMLText.Contains('50'), 'XML should contain Inventory');

        // Cleanup
        Item.Delete();
    end;

    [Test]
    procedure TestXMLportMultipleItems()
    var
        Item1: Record Item;
        Item2: Record Item;
        Item: Record Item;
        ItemExport: XMLport "Item Export";
        TempBlob: Codeunit "Temp Blob";
        OutStream: OutStream;
        InStream: InStream;
        XMLText: Text;
        Line: Text;
    begin
        // [SCENARIO] XMLport can export multiple items
        // [GIVEN] Multiple item records
        LibraryInventory.CreateItem(Item1);
        LibraryInventory.CreateItem(Item2);

        // [WHEN] We export all items
        TempBlob.CreateOutStream(OutStream);
        Item.SetFilter("No.", '%1|%2', Item1."No.", Item2."No.");
        ItemExport.SetTableView(Item);
        ItemExport.SetDestination(OutStream);
        ItemExport.Export();

        // [THEN] XML contains both items
        TempBlob.CreateInStream(InStream);
        XMLText := '';
        while not InStream.EOS() do begin
            InStream.ReadText(Line);
            XMLText += Line;
        end;
        Assert.IsTrue(XMLText.Contains(Item1."No."), 'XML should contain first item');
        Assert.IsTrue(XMLText.Contains(Item2."No."), 'XML should contain second item');

        // Cleanup
        Item1.Delete();
        Item2.Delete();
    end;

    [Test]
    procedure TestXMLportElementStructure()
    var
        Item: Record Item;
        ItemExport: XMLport "Item Export";
        TempBlob: Codeunit "Temp Blob";
        OutStream: OutStream;
        InStream: InStream;
        XMLText: Text;
        Line: Text;
    begin
        // [SCENARIO] Exported XML has correct element structure (Items root with Item children)
        // [GIVEN] An item record
        LibraryInventory.CreateItem(Item);

        // [WHEN] We export using the XMLport
        TempBlob.CreateOutStream(OutStream);
        Item.SetRange("No.", Item."No.");
        ItemExport.SetTableView(Item);
        ItemExport.SetDestination(OutStream);
        ItemExport.Export();

        // [THEN] XML has Items root element and Item child element
        TempBlob.CreateInStream(InStream);
        XMLText := '';
        while not InStream.EOS() do begin
            InStream.ReadText(Line);
            XMLText += Line;
        end;
        Assert.IsTrue(XMLText.Contains('<Items'), 'XML should have Items root element');
        Assert.IsTrue(XMLText.Contains('<Item'), 'XML should have Item child elements');
        Assert.IsTrue(XMLText.Contains('</Items>'), 'XML should have closing Items tag');

        // Cleanup
        Item.Delete();
    end;
}
