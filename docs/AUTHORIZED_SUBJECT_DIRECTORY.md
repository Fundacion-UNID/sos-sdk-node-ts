# Authorized subject directory

`SosGatewaySubjectDirectoryClient` is the single Node/BFF adapter for listing
human and animal cards already associated with a verified contact. Portals do
not build gateway paths, search Bundles or polling loops themselves.

The client submits and polls these SOS GW routes:

- `individual/org.schema/Organization/_search` and `_search-response` for
  owner/contact lookup and exact `sameAs` resolution;
- `individual/org.schema/License/_search` and `_search-response` for active,
  accepted relationship evidence.

`Organization.sameAs` remains the comma-separated flat claim used by the
confidential resource. SOS GW indexes every normalized non-empty alias as its
own protected indexed attribute. Exact resolution therefore searches one
alias; a returned CSV is accepted only when it contains that exact alias.
Animal entries accept only the current
`did:web:<provider>:card:vetchain:<speciesId7>:<cardNumber21>` form. The removed
split `jurisdiction5:animalId16` form fails closed.

Discovery is not authorization. A signed OpenID token is verified by the BFF;
the SDK receives only the verified contact and uses the token as server-side
transport evidence. Selecting a returned card creates no relationship and
grants no clinical, communication or emergency access.

## Multiple controllers and future rotation

One child or animal may have multiple active controllers, such as two parents,
two legal guardians or two responsible keepers. Each controller must have a
separate governed `RelatedPerson` relationship and accepted licence/evidence.
The subject card remains in the subject organization's
`org.schema.Organization.sameAs`; it must not become
`org.schema.Person.sameAs` of either controller.

A later lifecycle contract may designate one active relationship as the
principal administrative controller. Revoking that controller must revoke only
that person's relationship, licence and controller keys, then explicitly
promote another eligible active relationship. It must not rotate the child or
animal card DID, replace the subject organization, or infer succession from
CSV ordering. This principal-controller promotion flow is documented here but
is not implemented by the directory client.

Employees are a different subject. Their own professional aliases belong in
`org.schema.Person.sameAs`; SOS GW normalizes that CSV, indexes every alias
independently and projects the same aliases into the employee DID Document's
`alsoKnownAs` alongside its organization-employee authorization URN.
