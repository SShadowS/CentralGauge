codeunit 70481 "CG X083 Shipment Status Parser"
{
    var
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;

    procedure GetShipmentNo(XmlPayload: Text): Text
    var
        Doc: XmlDocument;
        NsManager: XmlNamespaceManager;
        ShipmentNoNode: XmlNode;
    begin
        LoadWithNamespaces(XmlPayload, Doc, NsManager);
        if not Doc.SelectSingleNode('/sh:ShipmentStatus/sh:Header/sh:ShipmentNo', NsManager, ShipmentNoNode) then
            exit('');
        exit(ShipmentNoNode.AsXmlElement().InnerText());
    end;

    procedure CountPackages(XmlPayload: Text): Integer
    var
        Doc: XmlDocument;
        NsManager: XmlNamespaceManager;
        PackageNodes: XmlNodeList;
    begin
        LoadWithNamespaces(XmlPayload, Doc, NsManager);
        Doc.SelectNodes('//sh:Package', NsManager, PackageNodes);
        exit(PackageNodes.Count());
    end;

    procedure GetTrackingNumbers(XmlPayload: Text): List of [Text]
    var
        Doc: XmlDocument;
        NsManager: XmlNamespaceManager;
        TrackingNode: XmlNode;
        TrackingNodes: XmlNodeList;
        TrackingNos: List of [Text];
    begin
        LoadWithNamespaces(XmlPayload, Doc, NsManager);
        Doc.SelectNodes('//trk:TrackingNo', NsManager, TrackingNodes);
        foreach TrackingNode in TrackingNodes do
            TrackingNos.Add(TrackingNode.AsXmlElement().InnerText());
        exit(TrackingNos);
    end;

    procedure GetWeightUnit(XmlPayload: Text): Text
    var
        Doc: XmlDocument;
        NsManager: XmlNamespaceManager;
        UnitNode: XmlNode;
    begin
        LoadWithNamespaces(XmlPayload, Doc, NsManager);
        if not Doc.SelectSingleNode('//sh:Weight/@unit', NsManager, UnitNode) then
            exit('');
        exit(UnitNode.AsXmlAttribute().Value());
    end;

    local procedure LoadWithNamespaces(XmlPayload: Text; var Doc: XmlDocument; var NsManager: XmlNamespaceManager)
    begin
        XmlDocument.ReadFrom(XmlPayload, Doc);
        NsManager.NameTable(Doc.NameTable());
        NsManager.AddNamespace('sh', ShippingNsLbl);
        NsManager.AddNamespace('trk', TrackingNsLbl);
    end;
}
